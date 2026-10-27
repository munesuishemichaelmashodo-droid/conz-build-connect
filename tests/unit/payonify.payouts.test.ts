import { describe, expect, it, vi } from "vitest";
import {
  lookUpPayout,
  processPayouts,
  sendPayout,
  type PayoutRow,
} from "@/lib/payonify.payouts.server";
import { PayonifyError, type PayonifyConfig, type Transfer } from "@/lib/payonify.server";

// Provider MOCKED: no network, no money.
const CFG: PayonifyConfig = { publishableKey: "pk_test_x", secretKey: "sk_test_x", mode: "test" };

const row = (over: Partial<PayoutRow> = {}): PayoutRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  driver_id: "d",
  job_id: "j",
  amount: "279.00",
  currency: "USD",
  livemode: false,
  ecocash_number: "772111111",
  status: "sending",
  idempotency_key: "22222222-2222-4222-8222-222222222222",
  provider_reference: null,
  attempts: 1,
  ...over,
});

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: "tr_1",
  object: "transfer",
  amount: { value: 27900, currency: "usd" },
  net_amount: { value: 27900, currency: "usd" },
  application_fee_amount: 0,
  status: "pending",
  livemode: false,
  created: 0,
  description: null,
  failure_code: null,
  failure_message: null,
  ...over,
});

function fakeDb(claimed: PayoutRow[] = [], due: PayoutRow[] = []) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      if (fn === "payout_claim_next") return { data: claimed, error: null };
      if (fn === "payout_due_lookups") return { data: due, error: null };
      return { data: {}, error: null };
    }),
  };
  return { db, calls };
}
const summary = () => ({
  claimed: 0,
  sent: 0,
  succeeded: 0,
  returned: 0,
  waiting: 0,
  unclear: 0,
  lookedUp: 0,
  errors: 0,
});

describe("sendPayout", () => {
  it("sends the driver's share in cents, with the payout's idempotency key and no commission", async () => {
    const { db, calls } = fakeDb();
    const send = vi.fn(async () => transfer());
    const s = summary();
    await sendPayout(db, CFG, row(), s, { sendTransfer: send });
    expect(send).toHaveBeenCalledWith(
      CFG,
      expect.objectContaining({
        amountMinor: 27900,
        commissionMinor: 0,
        currency: "usd",
        mobileNumber: "772111111",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(calls).toEqual([
      ["payout_record_sent", { _id: row().id, _reference: "tr_1", _net_amount: 279 }],
    ]);
    expect(s.sent).toBe(1);
  });

  it("records an immediate success", async () => {
    const { db, calls } = fakeDb();
    await sendPayout(db, CFG, row(), summary(), {
      sendTransfer: async () => transfer({ status: "succeeded" }),
    });
    expect(calls[0][0]).toBe("payout_record_result");
    expect(calls[0][1]).toMatchObject({ _outcome: "succeeded", _reference: "tr_1" });
  });

  it("waits and retries when settled funds are not available yet", async () => {
    const { db, calls } = fakeDb();
    const s = summary();
    await sendPayout(db, CFG, row(), s, {
      sendTransfer: async () => {
        throw new PayonifyError("Not enough available", 400, "insufficient_funds");
      },
    });
    expect(calls[0]).toEqual([
      "payout_record_result",
      expect.objectContaining({
        _outcome: "retry_later",
        _failure_code: "insufficient_funds",
        _retry_minutes: 60,
      }),
    ]);
    expect(s.waiting).toBe(1);
  });

  it("returns the money to the wallet when the number can't be paid", async () => {
    const { db, calls } = fakeDb();
    const s = summary();
    await sendPayout(db, CFG, row(), s, {
      sendTransfer: async () => {
        throw new PayonifyError("Recipient not found", 422, "recipient_not_found");
      },
    });
    expect(calls[0][1]).toMatchObject({ _outcome: "failed", _failure_code: "recipient_not_found" });
    expect(s.returned).toBe(1);
  });

  it("does nothing after a timeout: the row stays 'sending' and is retried with the same key", async () => {
    for (const err of [
      new PayonifyError("unreachable", 0, "network_error"),
      new PayonifyError("boom", 502, null),
      new PayonifyError("conflict", 409, "idempotency_error"),
    ]) {
      const { db, calls } = fakeDb();
      const s = summary();
      await sendPayout(db, CFG, row(), s, {
        sendTransfer: async () => {
          throw err;
        },
      });
      expect(calls).toEqual([]);
      expect(s.unclear).toBe(1);
    }
  });

  it("refuses a test payout with live keys (and the reverse)", async () => {
    const { db } = fakeDb();
    const send = vi.fn(async () => transfer());
    const s = summary();
    await sendPayout(db, { ...CFG, mode: "live" }, row({ livemode: false }), s, {
      sendTransfer: send,
    });
    await sendPayout(db, CFG, row({ livemode: true }), s, { sendTransfer: send });
    expect(send).not.toHaveBeenCalled();
    expect(s.errors).toBe(2);
  });

  it("does not record a transfer from the other mode or for a different amount as paid", async () => {
    const { db, calls } = fakeDb();
    const s = summary();
    await sendPayout(db, CFG, row(), s, { sendTransfer: async () => transfer({ livemode: true }) });
    expect(calls).toEqual([]);
    await sendPayout(db, CFG, row(), s, {
      sendTransfer: async () =>
        transfer({ status: "succeeded", amount: { value: 99999, currency: "usd" } }),
    });
    expect(calls).toEqual([
      ["payout_record_sent", expect.objectContaining({ _reference: "tr_1" })],
    ]);
    expect(s.succeeded).toBe(0);
  });
});

describe("lookUpPayout / processPayouts", () => {
  it("looks up sent transfers and records the final result", async () => {
    const { db, calls } = fakeDb();
    const s = summary();
    await lookUpPayout(db, CFG, row({ status: "sent", provider_reference: "tr_9" }), s, {
      fetchTransfer: async () =>
        transfer({ id: "tr_9", status: "failed", failure_code: "recipient_cannot_receive" }),
    });
    expect(calls[0][1]).toMatchObject({
      _outcome: "failed",
      _reference: "tr_9",
      _failure_code: "recipient_cannot_receive",
    });
    expect(s.returned).toBe(1);
  });

  it("leaves a still-pending transfer alone", async () => {
    const { db, calls } = fakeDb();
    await lookUpPayout(db, CFG, row({ status: "sent", provider_reference: "tr_9" }), summary(), {
      fetchTransfer: async () => transfer({ id: "tr_9", status: "pending" }),
    });
    expect(calls).toEqual([]);
  });

  it("claims test-mode payouts only with test keys, sends them, then does lookups", async () => {
    const { db, calls } = fakeDb(
      [row()],
      [row({ id: "x", status: "sent", provider_reference: "tr_2" })],
    );
    const s = await processPayouts(db, CFG, "test", {
      sendTransfer: async () => transfer(),
      fetchTransfer: async () => transfer({ id: "tr_2", status: "succeeded" }),
    });
    expect(calls[0]).toEqual(["payout_claim_next", { _limit: 10, _livemode: false }]);
    expect(s).toMatchObject({ claimed: 1, sent: 1, lookedUp: 1, succeeded: 1 });
  });
});
