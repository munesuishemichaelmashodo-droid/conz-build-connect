import { describe, expect, it, vi } from "vitest";
import { recheckLinkwaPayment, type RecheckDb } from "@/lib/payments/linkwa-recheck.server";
import { recheckMessage } from "@/lib/payments/linkwa-recheck-copy";
import type { ProviderAdapter, ProviderPaymentStatus } from "@/lib/payments/provider.server";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const PAY = "22222222-2222-4222-8222-222222222222";
const REF = "eb7de90e-347f-4deb-ae5b-879dff6bac87";

function fakeDb(
  opts: {
    isSuper?: boolean;
    shortUrl?: string | null;
    outcome?: string;
    applyError?: boolean;
  } = {},
) {
  const calls: { kind: string; name: string; args: unknown }[] = [];
  const db: RecheckDb = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: "rpc", name: fn, args });
      if (fn === "has_role") return Promise.resolve({ data: opts.isSuper ?? true, error: null });
      if (fn === "apply_provider_link_payment")
        return Promise.resolve(
          opts.applyError
            ? { data: null, error: { message: "boom" } }
            : { data: opts.outcome ?? "applied_paid", error: null },
        );
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    }),
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  opts.shortUrl === null
                    ? null
                    : { payment_id: PAY, short_url: opts.shortUrl ?? "bSXfw61" },
                error: null,
              }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        calls.push({ kind: "insert", name: table, args: row });
        return Promise.resolve({ data: null, error: null });
      },
    })),
  };
  return { db, calls };
}

function adapter(status: ProviderPaymentStatus | Error) {
  const getPaymentStatus = vi.fn(async () => {
    if (status instanceof Error) throw status;
    return status;
  });
  const a: ProviderAdapter = {
    name: "linkwa",
    verifyWebhook: async () => null,
    getPaymentStatus,
    getPayoutStatus: async () => ({ status: "unknown", reference: null }),
  };
  return { a, getPaymentStatus };
}

const PAID: ProviderPaymentStatus = {
  status: "paid",
  amount: 340,
  currency: "USD",
  reference: null,
  link: {},
};
const input = {
  actorId: ADMIN,
  paymentId: PAY,
  paymentReference: REF,
  reason: "Customer paid, never returned",
};

describe("admin Linkwa re-check", () => {
  it("asks Linkwa for the recorded link + reference and applies it like the return page, once, with an audit row", async () => {
    const { db, calls } = fakeDb();
    const { a, getPaymentStatus } = adapter(PAID);
    const r = await recheckLinkwaPayment(db, a, input);
    expect(r).toEqual({
      ok: true,
      outcome: "applied_paid",
      reportedStatus: "paid",
      reportedAmount: 340,
      reportedCurrency: "USD",
      auditLogged: true,
    });
    expect(getPaymentStatus).toHaveBeenCalledWith(PAY, {
      shortUrl: "bSXfw61",
      paymentReference: REF,
    });
    const apply = calls.find((c) => c.name === "apply_provider_link_payment")?.args as Record<
      string,
      unknown
    >;
    expect(apply).toMatchObject({
      _provider: "linkwa",
      _event_id: `status:${REF}:paid`, // same id as the customer's return page: a repeat is a duplicate
      _payment_id: PAY,
      _short_url: "bSXfw61",
      _payment_reference: REF,
      _amount: 340,
      _currency: "USD",
      _source: "status_check",
    });
    expect(calls.filter((c) => c.name === "apply_provider_link_payment")).toHaveLength(1);
    const audit = calls.find((c) => c.kind === "insert" && c.name === "admin_audit_log")
      ?.args as Record<string, unknown>;
    expect(audit).toMatchObject({
      actor_id: ADMIN,
      action: "linkwa_payment_recheck",
      target_id: PAY,
    });
  });

  it("refuses anyone who is not a super admin, before asking Linkwa", async () => {
    const { db, calls } = fakeDb({ isSuper: false });
    const { a, getPaymentStatus } = adapter(PAID);
    expect(await recheckLinkwaPayment(db, a, input)).toEqual({ ok: false, error: "forbidden" });
    expect(getPaymentStatus).not.toHaveBeenCalled();
    expect(calls.some((c) => c.name === "apply_provider_link_payment")).toBe(false);
  });

  it("refuses a payment with no Linkwa link recorded by ConZ", async () => {
    const { db } = fakeDb({ shortUrl: null });
    const { a, getPaymentStatus } = adapter(PAID);
    expect(await recheckLinkwaPayment(db, a, input)).toEqual({ ok: false, error: "not_found" });
    expect(getPaymentStatus).not.toHaveBeenCalled();
  });

  it("records nothing when Linkwa does not confirm the reference for this link (or is down)", async () => {
    const { db, calls } = fakeDb();
    const { a } = adapter(new Error("Linkwa status answer is for a different payment"));
    expect(await recheckLinkwaPayment(db, a, input)).toEqual({ ok: false, error: "check_failed" });
    expect(calls.some((c) => c.name === "apply_provider_link_payment")).toBe(false);
  });

  it("rejects bad input: short reason, odd reference, non-uuid payment", async () => {
    const { db } = fakeDb();
    const { a } = adapter(PAID);
    for (const bad of [
      { ...input, reason: "x" },
      { ...input, paymentReference: "ref with spaces" },
      { ...input, paymentReference: "<script>" },
      { ...input, paymentId: "not-a-uuid" },
    ]) {
      expect(await recheckLinkwaPayment(db, a, bad)).toEqual({ ok: false, error: "invalid_input" });
    }
  });

  it("a database error is reported and nothing is claimed", async () => {
    const { db } = fakeDb({ applyError: true });
    const { a } = adapter(PAID);
    expect(await recheckLinkwaPayment(db, a, input)).toEqual({ ok: false, error: "apply_failed" });
  });
});

describe("re-check messages", () => {
  it("only applied_paid is good news; flagged outcomes warn; nothing claims money moved when it did not", () => {
    expect(recheckMessage({ ok: true, outcome: "applied_paid" }).tone).toBe("good");
    expect(recheckMessage({ ok: true, outcome: "duplicate" }).text).toMatch(/Already recorded/);
    expect(recheckMessage({ ok: true, outcome: "pending_no_change" }).text).toMatch(
      /still says pending/,
    );
    expect(recheckMessage({ ok: true, outcome: "attempt_failed" }).text).toMatch(/stays open/);
    for (const o of [
      "rejected_amount",
      "second_payment_flagged",
      "unknown_status_flagged",
      "rejected_link",
    ]) {
      const m = recheckMessage({ ok: true, outcome: o });
      expect(m.tone).toBe("warn");
      expect(m.text).not.toMatch(/recorded as paid/);
    }
    expect(recheckMessage({ ok: false, error: "check_failed" }).text).toMatch(
      /Nothing was recorded/,
    );
  });
});
