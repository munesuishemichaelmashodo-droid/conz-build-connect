import { describe, expect, it, vi } from "vitest";
import {
  handlePayonifyWebhook,
  payonifyGateFor,
  payonifyMissingSettings,
  payonifyServerGate,
  PRODUCTION_SUPABASE_REF,
  readPaymentSwitch,
  startPayonifyCharge,
  type RpcDb,
} from "@/lib/payonify.process.server";
import {
  chargeFacts,
  isDefinitiveRejection,
  parseLivemode,
  PayonifyError,
  signPayonifyPayload,
  type Charge,
} from "@/lib/payonify.server";

// Provider MOCKED: fake keys, fake signatures made here, no network, no money.
const SECRET = "whsec_unit_test_only";
const PAY = "11111111-2222-4333-8444-555555555555";
const ENV = {
  PAYONIFY_MODE: "test",
  PAYONIFY_PUBLISHABLE_KEY: "pk_test_unit",
  PAYONIFY_SECRET_KEY: "sk_test_unit",
  PAYONIFY_WEBHOOK_SECRET: SECRET,
  SUPABASE_URL: "http://127.0.0.1:55431",
  PAYONIFY_TESTER_USER_IDS:
    "AAAAAAAA-0000-4000-8000-000000000001, bbbbbbbb-0000-4000-8000-000000000002",
};
const NOW = 1_800_000_000;

const charge = (over: Partial<Charge> = {}): Charge => ({
  id: "ch_1",
  object: "charge",
  amount: { value: 30000, currency: "usd" },
  status: "succeeded",
  livemode: false,
  metadata: { conz_payment_id: PAY, job_id: "j" },
  ...over,
});

async function signedEvent(event: Record<string, unknown>, t = NOW) {
  const raw = JSON.stringify(event);
  return { raw, header: `t=${t},v1=${await signPayonifyPayload(SECRET, t, raw)}` };
}

function fakeDb(
  responses: Record<string, { data?: unknown; error?: { message: string; code?: string } }> = {},
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db: RpcDb = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const r = responses[fn] ?? { data: { outcome: "ok", status: "initiated" } };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { db, calls };
}

describe("gate", () => {
  it("is off unless PAYONIFY_MODE is test or live", () => {
    for (const mode of [undefined, "", "on", "LIVE"])
      expect(payonifyServerGate({ ...ENV, PAYONIFY_MODE: mode })).toEqual({
        ok: false,
        reason: "disabled",
      });
  });
  it("live mode needs live keys, and may use the production database", () => {
    const live = {
      ...ENV,
      PAYONIFY_MODE: "live",
      PAYONIFY_PUBLISHABLE_KEY: "pk_live_x",
      PAYONIFY_SECRET_KEY: "sk_live_x",
      SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
    };
    expect(payonifyServerGate(live)).toMatchObject({ ok: true, mode: "live" });
    expect(payonifyServerGate({ ...ENV, PAYONIFY_MODE: "live" })).toEqual({
      ok: false,
      reason: "bad_keys",
    });
  });
  it("is off without keys, and refuses live keys", () => {
    expect(payonifyServerGate({ ...ENV, PAYONIFY_SECRET_KEY: "" })).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(
      payonifyServerGate({
        ...ENV,
        PAYONIFY_PUBLISHABLE_KEY: "pk_live_x",
        PAYONIFY_SECRET_KEY: "sk_live_x",
      }),
    ).toEqual({ ok: false, reason: "bad_keys" });
  });
  it("never runs against the production database", () => {
    expect(
      payonifyServerGate({
        ...ENV,
        SUPABASE_URL: `https://${PRODUCTION_SUPABASE_REF}.supabase.co`,
      }),
    ).toEqual({ ok: false, reason: "production_database" });
  });
  it("shows the option only to listed testers (case-insensitive)", () => {
    expect(payonifyGateFor(ENV, "aaaaaaaa-0000-4000-8000-000000000001").ok).toBe(true);
    expect(payonifyGateFor(ENV, "cccccccc-0000-4000-8000-000000000003")).toEqual({
      ok: false,
      reason: "not_a_tester",
    });
    expect(
      payonifyGateFor(
        { ...ENV, PAYONIFY_TESTER_USER_IDS: "" },
        "aaaaaaaa-0000-4000-8000-000000000001",
      ).ok,
    ).toBe(false);
  });
  it("offers it to everyone once the payment switch is on Payonify", () => {
    const stranger = "cccccccc-0000-4000-8000-000000000003";
    expect(payonifyGateFor(ENV, stranger, "paynow").ok).toBe(false);
    expect(payonifyGateFor(ENV, stranger, "payonify").ok).toBe(true);
    // ...but never when the server itself isn't set up for Payonify.
    expect(payonifyGateFor({ ...ENV, PAYONIFY_MODE: "" }, stranger, "payonify").ok).toBe(false);
  });
  it("reads the switch from the database, falling back to Paynow", async () => {
    const rpc = (data: unknown, fail = false) => ({
      rpc: async () => {
        if (fail) throw new Error("down");
        return { data, error: null };
      },
    });
    expect(await readPaymentSwitch(rpc({ paymentProvider: "payonify" }))).toBe("payonify");
    expect(await readPaymentSwitch(rpc({ paymentProvider: "paynow" }))).toBe("paynow");
    expect(await readPaymentSwitch(rpc({}))).toBe("paynow");
    expect(await readPaymentSwitch(rpc(null, true))).toBe("paynow");
  });
});

describe("charge parsing", () => {
  it("reads amount as the documented {value, currency} object", () => {
    expect(chargeFacts(charge())).toMatchObject({
      id: "ch_1",
      amountMinor: 30000,
      currency: "usd",
      livemode: false,
      conzPaymentId: PAY,
    });
  });
  it("accepts livemode as the string the docs show", () => {
    expect(parseLivemode("false")).toBe(false);
    expect(parseLivemode("true")).toBe(true);
    expect(parseLivemode("FALSE")).toBeNull();
    expect(parseLivemode(undefined)).toBeNull();
    expect(chargeFacts(charge({ livemode: "false" })).livemode).toBe(false);
  });
  it("leaves malformed fields null rather than guessing", () => {
    const f = chargeFacts(
      charge({ amount: { value: 12.5 as unknown as number, currency: "usd" }, metadata: null }),
    );
    expect(f.amountMinor).toBeNull();
    expect(f.conzPaymentId).toBeNull();
  });
});

describe("error classification", () => {
  it("treats only clear 4xx refusals as 'nothing was created'", () => {
    expect(isDefinitiveRejection(new PayonifyError("bad", 400, "invalid_request"))).toBe(true);
    expect(isDefinitiveRejection(new PayonifyError("auth", 401, null))).toBe(true);
    for (const s of [0, 408, 409, 429, 500, 502, 504])
      expect(isDefinitiveRejection(new PayonifyError("unclear", s, null))).toBe(false);
    expect(isDefinitiveRejection(new Error("boom"))).toBe(false);
  });
});

describe("webhook", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    id: "evt_1",
    type: "charge.succeeded",
    object: "event",
    created: NOW,
    livemode: "false",
    data: { object: { id: "ch_1", object: "charge" } },
    ...over,
  });

  it("returns 503 while Payonify is not enabled on this deployment", async () => {
    const { raw, header } = await signedEvent(event());
    const { db, calls } = fakeDb();
    const r = await handlePayonifyWebhook(raw, header, {
      env: { ...ENV, PAYONIFY_MODE: "" },
      db,
      nowSeconds: NOW,
    });
    expect(r.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it("rejects a bad signature, a tampered body and an old timestamp without touching the database", async () => {
    const { raw, header } = await signedEvent(event());
    const { db, calls } = fakeDb();
    const deps = { env: ENV, db, nowSeconds: NOW, fetchCharge: vi.fn() };
    expect((await handlePayonifyWebhook(raw, "t=1,v1=00", deps)).status).toBe(400);
    expect((await handlePayonifyWebhook(raw.replace("evt_1", "evt_2"), header, deps)).status).toBe(
      400,
    );
    expect(
      (await handlePayonifyWebhook(raw, header, { ...deps, nowSeconds: NOW + 301 })).status,
    ).toBe(400);
    expect((await handlePayonifyWebhook(raw, null, deps)).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(deps.fetchCharge).not.toHaveBeenCalled();
  });

  it("refuses live events while sandbox-only", async () => {
    const { raw, header } = await signedEvent(event({ livemode: true }));
    const { db } = fakeDb();
    expect(
      (await handlePayonifyWebhook(raw, header, { env: ENV, db, nowSeconds: NOW })).status,
    ).toBe(400);
  });

  it("re-fetches the charge and applies Payonify's copy, not the webhook body", async () => {
    // The body claims a different amount; only the fetched charge counts.
    const { raw, header } = await signedEvent(
      event({
        data: {
          object: {
            id: "ch_1",
            amount: { value: 1, currency: "usd" },
            metadata: { conz_payment_id: "x" },
          },
        },
      }),
    );
    const { db, calls } = fakeDb({
      apply_payonify_charge: { data: { outcome: "escrow_marked_paid", status: "paid" } },
    });
    const fetchCharge = vi.fn(async () => charge());
    const r = await handlePayonifyWebhook(raw, header, {
      env: ENV,
      db,
      nowSeconds: NOW,
      fetchCharge,
    });
    expect(r).toEqual({ status: 200, body: { received: true, outcome: "escrow_marked_paid" } });
    expect(fetchCharge).toHaveBeenCalledWith(
      expect.objectContaining({ secretKey: "sk_test_unit" }),
      "ch_1",
    );
    expect(calls[0]).toEqual({
      fn: "apply_payonify_charge",
      args: {
        _payment_id: PAY,
        _source: "ipn",
        _event_id: "evt_1",
        _charge_id: "ch_1",
        _charge_status: "succeeded",
        _amount_minor: 30000,
        _currency: "usd",
        _livemode: false,
        _metadata_payment_id: PAY,
      },
    });
  });

  it("asks Payonify to retry (5xx) when the charge can't be fetched or the database fails", async () => {
    const { raw, header } = await signedEvent(event());
    const failing = vi.fn(async () => {
      throw new PayonifyError("down", 502, null);
    });
    expect(
      (
        await handlePayonifyWebhook(raw, header, {
          env: ENV,
          db: fakeDb().db,
          nowSeconds: NOW,
          fetchCharge: failing,
        })
      ).status,
    ).toBe(503);
    const { db } = fakeDb({ apply_payonify_charge: { error: { message: "connection reset" } } });
    expect(
      (
        await handlePayonifyWebhook(raw, header, {
          env: ENV,
          db,
          nowSeconds: NOW,
          fetchCharge: async () => charge(),
        })
      ).status,
    ).toBe(500);
  });

  it("records, and does not apply, a charge that names no ConZ payment or is live", async () => {
    const { raw, header } = await signedEvent(event());
    for (const c of [
      charge({ metadata: {} }),
      charge({ livemode: true }),
      charge({ id: "ch_other" }),
    ]) {
      const { db, calls } = fakeDb({ record_payonify_event: { data: { outcome: "x" } } });
      const r = await handlePayonifyWebhook(raw, header, {
        env: ENV,
        db,
        nowSeconds: NOW,
        fetchCharge: async () => c,
      });
      expect(r.status).toBe(200);
      expect(calls.map((x) => x.fn)).toEqual(["record_payonify_event"]);
    }
  });

  it("records an unknown payment instead of retrying forever", async () => {
    const { raw, header } = await signedEvent(event());
    const { db, calls } = fakeDb({
      apply_payonify_charge: { error: { message: "payment_not_found", code: "P0002" } },
      record_payonify_event: { data: { outcome: "unknown_payment" } },
    });
    const r = await handlePayonifyWebhook(raw, header, {
      env: ENV,
      db,
      nowSeconds: NOW,
      fetchCharge: async () => charge(),
    });
    expect(r.status).toBe(200);
    expect(calls.map((x) => x.fn)).toEqual(["apply_payonify_charge", "record_payonify_event"]);
    expect(calls[1].args).toMatchObject({ _payment_id: null, _outcome: "unknown_payment" });
  });

  it("records other event types once without acting on them", async () => {
    const { raw, header } = await signedEvent(
      event({ id: "evt_t", type: "transfer.succeeded", data: { object: { id: "tr_1" } } }),
    );
    const { db, calls } = fakeDb({
      record_payonify_event: { data: { outcome: "recorded_unhandled" } },
    });
    const fetchCharge = vi.fn();
    const r = await handlePayonifyWebhook(raw, header, {
      env: ENV,
      db,
      nowSeconds: NOW,
      fetchCharge,
    });
    expect(r.status).toBe(200);
    expect(fetchCharge).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({
      fn: "record_payonify_event",
      args: { _event_id: "evt_t", _event_type: "transfer.succeeded", _object_id: "tr_1" },
    });
  });
});

describe("live webhooks", () => {
  const LIVE = {
    ...ENV,
    PAYONIFY_MODE: "live",
    PAYONIFY_PUBLISHABLE_KEY: "pk_live_unit",
    PAYONIFY_SECRET_KEY: "sk_live_unit",
  };
  const ev = (livemode: unknown) => ({
    id: "evt_live",
    type: "charge.succeeded",
    object: "event",
    created: NOW,
    livemode,
    data: { object: { id: "ch_1" } },
  });
  it("accepts a live event and a live charge in live mode", async () => {
    const { raw, header } = await signedEvent(ev("true"));
    const { db, calls } = fakeDb({ apply_payonify_charge: { data: { outcome: "credited" } } });
    const r = await handlePayonifyWebhook(raw, header, {
      env: LIVE,
      db,
      nowSeconds: NOW,
      fetchCharge: async () => charge({ livemode: true }),
    });
    expect(r.status).toBe(200);
    expect(calls[0].args).toMatchObject({ _livemode: true });
  });
  it("refuses a test event in live mode", async () => {
    const { raw, header } = await signedEvent(ev(false));
    const { db } = fakeDb();
    expect(
      (await handlePayonifyWebhook(raw, header, { env: LIVE, db, nowSeconds: NOW })).status,
    ).toBe(400);
  });
});

describe("starting a charge", () => {
  // A tiny stand-in for the service-role client: records inserts/updates and rpc calls.
  function chain(insertResult: { data: unknown; error: unknown }) {
    const log: string[] = [];
    const db = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          log.push(`insert ${row.type} ${row.provider} livemode=${row.provider_livemode}`);
          return { select: () => ({ single: async () => insertResult }) };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            log.push(`update ${JSON.stringify(patch)}`);
            return { error: null };
          },
        }),
      }),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        log.push(`rpc ${fn} ${String(args._outcome ?? args._source ?? "")}`);
        return { data: { outcome: "pending_no_change", status: "initiated" }, error: null };
      },
    };
    return { db, log };
  }
  const gate = {
    cfg: { publishableKey: "pk_test_x", secretKey: "sk_test_x" },
    mode: "test" as const,
  };
  const row = { userId: "u", jobId: null, type: "topup" as const, amount: 10 };
  const ch = { amountMinor: 1000, mobileNumber: "0772111111", description: "ConZ wallet top-up" };

  it("records the payment first, keeps the charge id, then applies the reply", async () => {
    const { db, log } = chain({ data: { id: PAY }, error: null });
    const createCharge = vi.fn(async () => charge({ status: "pending" }));
    const r = await startPayonifyCharge(db, gate, row, ch, { createCharge });
    expect(r).toEqual({ ok: true, paymentId: PAY, status: "initiated" });
    expect(log).toEqual([
      "insert topup payonify livemode=false",
      'update {"provider_reference":"ch_1"}',
      "rpc apply_payonify_charge initiate",
    ]);
    expect(createCharge.mock.calls[0][1]).toMatchObject({
      metadata: { conz_payment_id: PAY, kind: "topup" },
    });
  });
  it("passes on the database's own top-up limit message", async () => {
    const { db } = chain({
      data: null,
      error: { code: "P0001", message: "Your ConZ credit can hold at most $150." },
    });
    const createCharge = vi.fn();
    expect(await startPayonifyCharge(db, gate, row, ch, { createCharge })).toMatchObject({
      ok: false,
      message: "Your ConZ credit can hold at most $150.",
    });
    expect(createCharge).not.toHaveBeenCalled();
  });
  it("closes the payment only when Payonify clearly refused", async () => {
    const refused = chain({ data: { id: PAY }, error: null });
    const r1 = await startPayonifyCharge(refused.db, gate, row, ch, {
      createCharge: async () => {
        throw new PayonifyError("bad number", 400, "invalid_request");
      },
    });
    expect(r1).toMatchObject({ ok: false, error: "payment_declined" });
    expect(refused.log).toContain('update {"status":"failed"}');

    const unclear = chain({ data: { id: PAY }, error: null });
    const r2 = await startPayonifyCharge(unclear.db, gate, row, ch, {
      createCharge: async () => {
        throw new PayonifyError("timeout", 0, "network_error");
      },
    });
    expect(r2).toMatchObject({ ok: false, error: "payment_status_unknown", paymentId: PAY });
    expect(unclear.log.some((l) => l.includes("failed"))).toBe(false);
    expect(unclear.log).toContain("rpc record_payment_event initiate_unclear");
  });
  it("refuses a second open attempt (another tap won the race)", async () => {
    const { db } = chain({ data: null, error: { code: "23505", message: "duplicate" } });
    expect(await startPayonifyCharge(db, gate, row, ch, { createCharge: vi.fn() })).toMatchObject({
      ok: false,
      error: "other_payment_open",
    });
  });
});

describe("payonifyMissingSettings", () => {
  it("lists empty settings by name only", () => {
    expect(payonifyMissingSettings(ENV)).toEqual([]);
    expect(
      payonifyMissingSettings({
        ...ENV,
        PAYONIFY_PUBLISHABLE_KEY: " ",
        PAYONIFY_WEBHOOK_SECRET: undefined,
      }),
    ).toEqual(["PAYONIFY_PUBLISHABLE_KEY", "PAYONIFY_WEBHOOK_SECRET"]);
    expect(payonifyMissingSettings({})).toHaveLength(4);
  });
});
