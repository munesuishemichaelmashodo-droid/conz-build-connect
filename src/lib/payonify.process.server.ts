// Server-only: decides when Payonify may be used, and turns Payonify charge results into
// ConZ payment state through apply_payonify_charge (migration 0120) — the only place a
// Payonify result changes a payment. Kept free of framework imports so it is unit-testable.
//
// Rules this file enforces:
//   - Off unless PAYONIFY_MODE is "test" or "live" and keys of that mode are configured.
//   - Test mode never runs against the production database (fake money must never mark real
//     jobs paid or credit real wallets).
//   - Who sees it: listed testers always (for the sandbox and the owner's $1 live test);
//     everyone once a super admin sets the payment switch to Payonify (launch_switches()).
//   - A webhook is never trusted on its own: after the signature check, the charge is re-fetched
//     from Payonify's API and that authoritative copy is applied.
//   - Every verified event is recorded once (by event id); repeats are acknowledged and ignored.
//   - Database or Payonify API failures return 5xx so Payonify retries the webhook.

import {
  chargeFacts,
  createEcocashCharge,
  getCharge,
  isDefinitiveRejection,
  PayonifyError,
  getPayonifyConfig,
  verifyPayonifyWebhook,
  type Charge,
  type ChargeFacts,
  type PayonifyConfig,
  type PayonifyMode,
} from "@/lib/payonify.server";

/** Production Supabase project. Sandbox (test-mode) charges are refused against it. */
export const PRODUCTION_SUPABASE_REF = "ovwrsocjmkpiygipmrdk";

type Env = Record<string, string | undefined>;

export type GateResult =
  | { ok: true; cfg: PayonifyConfig; mode: PayonifyMode }
  | {
      ok: false;
      reason: "disabled" | "not_configured" | "bad_keys" | "production_database" | "not_a_tester";
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/**
 * Names (never values) of the settings Payonify needs that are empty on this deployment, so
 * the admin panel can say exactly what to add.
 */
export function payonifyMissingSettings(env: Env): string[] {
  const names = [
    "PAYONIFY_MODE",
    "PAYONIFY_PUBLISHABLE_KEY",
    "PAYONIFY_SECRET_KEY",
    "PAYONIFY_WEBHOOK_SECRET",
  ];
  return names.filter((n) => !(env[n] ?? "").trim());
}

/** Server-side switch for the whole integration (webhook included). */
export function payonifyServerGate(env: Env): GateResult {
  const raw = (env["PAYONIFY_MODE"] ?? "").trim();
  if (raw !== "test" && raw !== "live") return { ok: false, reason: "disabled" };
  const mode: PayonifyMode = raw;
  let cfg: PayonifyConfig | null;
  try {
    cfg = getPayonifyConfig(env, mode);
  } catch {
    return { ok: false, reason: "bad_keys" };
  }
  if (!cfg) return { ok: false, reason: "not_configured" };
  if (mode === "test" && (env["SUPABASE_URL"] ?? "").includes(PRODUCTION_SUPABASE_REF)) {
    return { ok: false, reason: "production_database" };
  }
  return { ok: true, cfg, mode };
}

export const isPayonifyTester = (env: Env, userId: string) =>
  (env["PAYONIFY_TESTER_USER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(userId.toLowerCase());

/**
 * May this user start a Payonify payment? Testers always (when configured); everyone else only
 * once the payment switch (launch_switches().paymentProvider) is set to Payonify.
 */
export function payonifyGateFor(
  env: Env,
  userId: string,
  switchProvider: "paynow" | "payonify" = "paynow",
): GateResult {
  const gate = payonifyServerGate(env);
  if (!gate.ok) return gate;
  if (switchProvider === "payonify" || isPayonifyTester(env, userId)) return gate;
  return { ok: false, reason: "not_a_tester" };
}

/** The payment switch as the database reports it. Anything unreadable means Paynow. */
export async function readPaymentSwitch(db: RpcDb): Promise<"paynow" | "payonify"> {
  try {
    const { data } = await db.rpc("launch_switches", {});
    return (data as { paymentProvider?: string } | null)?.paymentProvider === "payonify"
      ? "payonify"
      : "paynow";
  } catch {
    return "paynow";
  }
}

// Minimal view of the service-role Supabase client used here.
export type RpcDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type ApplyResult =
  | { ok: true; outcome: string; status: string | null }
  | { ok: false; error: string; notFound?: boolean };

export async function applyPayonifyCharge(
  db: RpcDb,
  paymentId: string,
  source: "initiate" | "ipn" | "poll" | "reconcile",
  eventId: string | null,
  facts: ChargeFacts,
): Promise<ApplyResult> {
  const { data, error } = await db.rpc("apply_payonify_charge", {
    _payment_id: paymentId,
    _source: source,
    _event_id: eventId,
    _charge_id: facts.id,
    _charge_status: facts.status,
    _amount_minor: facts.amountMinor,
    _currency: facts.currency,
    _livemode: facts.livemode,
    _metadata_payment_id: facts.conzPaymentId,
  });
  if (error) {
    const notFound = error.code === "P0002" || /payment_not_found/.test(error.message);
    return { ok: false, error: error.message, notFound };
  }
  const r = (data ?? {}) as { outcome?: string; status?: string };
  return { ok: true, outcome: r.outcome ?? "unknown", status: r.status ?? null };
}

async function recordEvent(
  db: RpcDb,
  eventId: string,
  eventType: string,
  objectId: string | null,
  paymentId: string | null,
  outcome: string,
  livemode = false,
): Promise<{ ok: boolean; outcome: string }> {
  const { data, error } = await db.rpc("record_payonify_event", {
    _event_id: eventId,
    _event_type: eventType,
    _object_id: objectId,
    _payment_id: paymentId,
    _livemode: livemode,
    _outcome: outcome,
  });
  if (error) return { ok: false, outcome: "db_error" };
  return { ok: true, outcome: ((data ?? {}) as { outcome?: string }).outcome ?? outcome };
}

export type WebhookDeps = {
  env: Env;
  db: RpcDb;
  fetchCharge?: (cfg: PayonifyConfig, id: string) => Promise<Charge>;
  nowSeconds?: number;
};

export type WebhookResponse = { status: number; body: Record<string, unknown> };

/**
 * Handles one POST to /api/payonify/webhook. 2xx tells Payonify to stop retrying, so it is
 * returned only once the event is safely recorded (or is a repeat). 400 for a bad signature;
 * 5xx when ConZ could not record or check it, so Payonify tries again.
 */
export async function handlePayonifyWebhook(
  rawBody: string,
  signatureHeader: string | null,
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  const gate = payonifyServerGate(deps.env);
  if (!gate.ok) return { status: 503, body: { error: "payonify_not_enabled" } };
  const secret = deps.env["PAYONIFY_WEBHOOK_SECRET"]?.trim();
  if (!secret) return { status: 503, body: { error: "webhook_secret_not_configured" } };

  const live = gate.mode === "live";
  const event = await verifyPayonifyWebhook(
    rawBody,
    signatureHeader,
    secret,
    deps.nowSeconds,
    live,
  );
  if (!event) return { status: 400, body: { error: "invalid_signature" } };

  const obj = event.data.object as { id?: unknown };
  const objectId = typeof obj.id === "string" && obj.id ? obj.id : null;

  if (!event.type.startsWith("charge.")) {
    // Transfers, refunds, reversals, payouts, checkout: not acted on yet; recorded for admins.
    const r = await recordEvent(
      deps.db,
      event.id,
      event.type,
      objectId,
      null,
      "recorded_unhandled",
      live,
    );
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }

  if (!objectId) {
    const r = await recordEvent(deps.db, event.id, event.type, null, null, "no_charge_id", live);
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }

  // Never act on the webhook body: fetch the charge from Payonify and apply that.
  let charge: Charge;
  try {
    charge = await (deps.fetchCharge ?? getCharge)(gate.cfg, objectId);
  } catch {
    return { status: 503, body: { error: "charge_lookup_failed" } };
  }
  const facts = chargeFacts(charge);

  if (facts.id !== objectId || facts.livemode !== live) {
    const r = await recordEvent(
      deps.db,
      event.id,
      event.type,
      objectId,
      null,
      "refused_mismatch_or_mode",
      live,
    );
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }
  if (!isUuid(facts.conzPaymentId)) {
    const r = await recordEvent(
      deps.db,
      event.id,
      event.type,
      objectId,
      null,
      "no_conz_payment",
      live,
    );
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }

  const applied = await applyPayonifyCharge(deps.db, facts.conzPaymentId, "ipn", event.id, facts);
  if (!applied.ok) {
    if (applied.notFound) {
      const r = await recordEvent(
        deps.db,
        event.id,
        event.type,
        objectId,
        null,
        "unknown_payment",
        live,
      );
      return r.ok
        ? { status: 200, body: { received: true, outcome: r.outcome } }
        : { status: 500, body: { error: "db_error" } };
    }
    return { status: 500, body: { error: "db_error" } };
  }
  return { status: 200, body: { received: true, outcome: applied.outcome } };
}

// --- Starting a charge ---------------------------------------------------------------------

export type StartRow = {
  userId: string;
  jobId: string | null;
  type: "escrow" | "topup";
  amount: number;
};

export type StartOutcome =
  | { ok: true; paymentId: string; status: string | null }
  | {
      ok: false;
      error:
        | "other_payment_open"
        | "payment_create_failed"
        | "payment_declined"
        | "payment_status_unknown";
      paymentId?: string;
      /** A sentence the database wrote for the user (e.g. top-up limits), shown as is. */
      message?: string;
    };

/**
 * Records the payment BEFORE calling Payonify (so a crash mid-call leaves a trace), creates the
 * EcoCash charge, keeps the charge id, and applies Payonify's reply through the guarded function.
 * Only a clear refusal closes the payment; an unclear failure leaves it open for a status check
 * or the webhook, and the charge is never retried blindly (Payonify documents no idempotency).
 */
export async function startPayonifyCharge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role client; 0120 columns are not in the generated types yet
  db: any,
  gate: { cfg: PayonifyConfig; mode: PayonifyMode },
  row: StartRow,
  charge: { amountMinor: number; mobileNumber: string; description: string },
  deps: { createCharge?: typeof createEcocashCharge } = {},
): Promise<StartOutcome> {
  const { data: payment, error } = await db
    .from("payments")
    .insert({
      user_id: row.userId,
      job_id: row.jobId,
      type: row.type,
      amount: row.amount,
      currency: "USD",
      method: "payonify",
      status: "initiated",
      provider: "payonify",
      provider_livemode: gate.mode === "live",
    })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, error: "other_payment_open" }; // a parallel tap won
  if (error?.code === "P0001") {
    return { ok: false, error: "payment_create_failed", message: error.message };
  }
  if (error || !payment) return { ok: false, error: "payment_create_failed" };

  try {
    const created = await (deps.createCharge ?? createEcocashCharge)(gate.cfg, {
      amountMinor: charge.amountMinor,
      currency: "usd",
      mobileNumber: charge.mobileNumber,
      description: charge.description,
      metadata: row.jobId
        ? { conz_payment_id: payment.id, job_id: row.jobId }
        : { conz_payment_id: payment.id, kind: row.type },
    });
    const facts = chargeFacts(created);
    // The charge we just created is ours: keep its id even if a check below rejects the
    // reply, so a status check or an admin can always find it at Payonify.
    if (facts.id) {
      await db.from("payments").update({ provider_reference: facts.id }).eq("id", payment.id);
    }
    const applied = await applyPayonifyCharge(db, payment.id, "initiate", null, facts);
    if (!applied.ok) return { ok: false, error: "payment_status_unknown", paymentId: payment.id };
    return { ok: true, paymentId: payment.id, status: applied.status };
  } catch (err) {
    const detail =
      err instanceof PayonifyError ? `${err.status} ${err.code ?? ""}`.trim() : "unexpected error";
    if (isDefinitiveRejection(err)) {
      // Payonify answered and refused: nothing was created, so the attempt is closed.
      await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
      await db.rpc("record_payment_event", {
        _payment_id: payment.id,
        _source: "initiate",
        _outcome: "provider_rejected",
        _detail: detail,
      });
      return { ok: false, error: "payment_declined", paymentId: payment.id };
    }
    await db.rpc("record_payment_event", {
      _payment_id: payment.id,
      _source: "initiate",
      _outcome: "initiate_unclear",
      _detail: detail,
    });
    return { ok: false, error: "payment_status_unknown", paymentId: payment.id };
  }
}
