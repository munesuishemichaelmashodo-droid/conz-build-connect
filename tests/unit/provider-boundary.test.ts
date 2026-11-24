import { describe, expect, it, vi } from "vitest";
import {
  PROVIDER_REGISTRY,
  handleProviderWebhook,
  resolvePayoutByStatusCheck,
  type ProviderAdapter,
  type ProviderDb,
} from "@/lib/payments/provider.server";

function fakeDb(
  overrides: Partial<Record<string, { data: unknown; error: { message: string } | null }>> = {},
) {
  const calls: { fn: string; args: unknown }[] = [];
  const db = {
    rpc: vi.fn((fn: string, args?: unknown) => {
      calls.push({ fn, args });
      const r = overrides[fn] ?? {
        data: fn === "provider_collection_enabled" ? true : "applied_paid",
        error: null,
      };
      return Promise.resolve(r);
    }),
  } as unknown as ProviderDb;
  return { db, calls };
}

function adapter(over: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    name: "testpay",
    verifyWebhook: async () => ({ eventId: "evt-1", paymentId: "pay-1" }),
    getPaymentStatus: async () => ({
      status: "paid",
      amount: 300,
      currency: "USD",
      reference: "ref-1",
    }),
    getPayoutStatus: async () => ({ status: "paid", reference: "po-1" }),
    ...over,
  };
}

const reg = (a: ProviderAdapter) => ({ [a.name]: a });
const H = new Headers();

describe("provider webhook boundary", () => {
  it("no provider is approved: the real registry is empty", () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual([]);
  });

  it("unknown provider -> 404, database untouched", async () => {
    const { db, calls } = fakeDb();
    const res = await handleProviderWebhook("nobody", "{}", H, db, reg(adapter()));
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("collection switched off -> 404, nothing applied", async () => {
    const { db, calls } = fakeDb({ provider_collection_enabled: { data: false, error: null } });
    const res = await handleProviderWebhook("testpay", "{}", H, db, reg(adapter()));
    expect(res.status).toBe(404);
    expect(calls.map((c) => c.fn)).toEqual(["provider_collection_enabled"]);
  });

  it("bad signature -> 401, nothing applied", async () => {
    const { db, calls } = fakeDb();
    const res = await handleProviderWebhook(
      "testpay",
      "{}",
      H,
      db,
      reg(adapter({ verifyWebhook: async () => null })),
    );
    expect(res.status).toBe(401);
    expect(calls.some((c) => c.fn === "apply_provider_payment")).toBe(false);
  });

  it("a throwing verifier is treated as a bad signature", async () => {
    const { db } = fakeDb();
    const res = await handleProviderWebhook(
      "testpay",
      "{}",
      H,
      db,
      reg(
        adapter({
          verifyWebhook: async () => {
            throw new Error("boom");
          },
        }),
      ),
    );
    expect(res.status).toBe(401);
  });

  it("applies the RE-CHECKED status, never the callback's own claims", async () => {
    const { db, calls } = fakeDb();
    const body = JSON.stringify({ status: "paid", amount: 999999, currency: "USD" }); // forged claims
    const res = await handleProviderWebhook(
      "testpay",
      body,
      H,
      db,
      reg(
        adapter({
          getPaymentStatus: async () => ({
            status: "pending",
            amount: 300,
            currency: "USD",
            reference: "ref-1",
          }),
        }),
      ),
    );
    expect(res.status).toBe(200);
    const apply = calls.find((c) => c.fn === "apply_provider_payment");
    expect(apply?.args).toMatchObject({
      _status: "pending",
      _amount: 300,
      _event_id: "evt-1",
      _payment_id: "pay-1",
      _source: "webhook",
    });
  });

  it("provider unreachable on re-check -> 503 and nothing applied (provider retries)", async () => {
    const { db, calls } = fakeDb();
    const res = await handleProviderWebhook(
      "testpay",
      "{}",
      H,
      db,
      reg(
        adapter({
          getPaymentStatus: async () => {
            throw new Error("timeout");
          },
        }),
      ),
    );
    expect(res.status).toBe(503);
    expect(calls.some((c) => c.fn === "apply_provider_payment")).toBe(false);
  });

  it("a database error is 502 so the provider retries", async () => {
    const { db } = fakeDb({ apply_provider_payment: { data: null, error: { message: "x" } } });
    const res = await handleProviderWebhook("testpay", "{}", H, db, reg(adapter()));
    expect(res.status).toBe(502);
  });

  it("prototype keys are not providers", async () => {
    const { db } = fakeDb();
    const res = await handleProviderWebhook("constructor", "{}", H, db, reg(adapter()));
    expect(res.status).toBe(404);
  });
});

describe("payout status check (never a blind resend)", () => {
  const payout = { id: "po-row", idempotencyKey: "conz-payout-x-1", providerReference: "po-1" };

  it("records what the provider says", async () => {
    const { db, calls } = fakeDb({ payout_record_result: { data: {}, error: null } });
    expect(await resolvePayoutByStatusCheck(adapter(), db, payout)).toBe("paid");
    expect(calls[0]).toEqual({
      fn: "payout_record_result",
      args: { _payout_id: "po-row", _status: "paid", _provider_reference: "po-1", _error: null },
    });
  });

  it("a failed status check is recorded as unknown, not failed (so no retry)", async () => {
    const { db, calls } = fakeDb({ payout_record_result: { data: {}, error: null } });
    const a = adapter({
      getPayoutStatus: async () => {
        throw new Error("timeout");
      },
    });
    expect(await resolvePayoutByStatusCheck(a, db, payout)).toBe("unknown");
    expect((calls[0].args as { _status: string })._status).toBe("unknown");
  });

  it("an unexpected provider word is treated as unknown", async () => {
    const { db } = fakeDb({ payout_record_result: { data: {}, error: null } });
    const a = adapter({
      getPayoutStatus: async () => ({ status: "processing" as never, reference: null }),
    });
    expect(await resolvePayoutByStatusCheck(a, db, payout)).toBe("unknown");
  });
});
