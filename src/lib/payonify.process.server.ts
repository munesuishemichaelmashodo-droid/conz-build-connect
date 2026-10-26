// Server-only: decides when Payonify may be used, and turns Payonify charge results into
// ConZ payment state through apply_payonify_charge (migration 0120) — the only place a
// Payonify result changes a payment. Kept free of framework imports so it is unit-testable.
//
// Rules this file enforces:
//   - Off unless PAYONIFY_MODE=test, test keys are configured, and the server is NOT using the
//     production database (sandbox charges must never move production money state).
//   - A webhook is never trusted on its own: after the signature check, the charge is re-fetched
//     from Payonify's API and that authoritative copy is applied.
//   - Every verified event is recorded once (by event id); repeats are acknowledged and ignored.
//   - Database or Payonify API failures return 5xx so Payonify retries the webhook.

import {
  chargeFacts,
  getCharge,
  getPayonifyConfig,
  verifyPayonifyWebhook,
  type Charge,
  type ChargeFacts,
  type PayonifyConfig,
} from "@/lib/payonify.server";

/** Production Supabase project. Sandbox (test-mode) charges are refused against it. */
export const PRODUCTION_SUPABASE_REF = "ovwrsocjmkpiygipmrdk";

type Env = Record<string, string | undefined>;

export type GateResult =
  | { ok: true; cfg: PayonifyConfig }
  | {
      ok: false;
      reason: "disabled" | "not_configured" | "bad_keys" | "production_database" | "not_a_tester";
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Server-side switch for the whole integration (webhook included). */
export function payonifyServerGate(env: Env): GateResult {
  if ((env["PAYONIFY_MODE"] ?? "").trim() !== "test") return { ok: false, reason: "disabled" };
  let cfg: PayonifyConfig | null;
  try {
    cfg = getPayonifyConfig(env);
  } catch {
    return { ok: false, reason: "bad_keys" };
  }
  if (!cfg) return { ok: false, reason: "not_configured" };
  if ((env["SUPABASE_URL"] ?? "").includes(PRODUCTION_SUPABASE_REF)) {
    return { ok: false, reason: "production_database" };
  }
  return { ok: true, cfg };
}

/** Who may see the Payonify option: only listed tester accounts, never ordinary customers. */
export function payonifyGateFor(env: Env, userId: string): GateResult {
  const gate = payonifyServerGate(env);
  if (!gate.ok) return gate;
  const testers = (env["PAYONIFY_TESTER_USER_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!testers.includes(userId.toLowerCase())) return { ok: false, reason: "not_a_tester" };
  return gate;
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
): Promise<{ ok: boolean; outcome: string }> {
  const { data, error } = await db.rpc("record_payonify_event", {
    _event_id: eventId,
    _event_type: eventType,
    _object_id: objectId,
    _payment_id: paymentId,
    _livemode: false,
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

  const event = await verifyPayonifyWebhook(rawBody, signatureHeader, secret, deps.nowSeconds);
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
    );
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }

  if (!objectId) {
    const r = await recordEvent(deps.db, event.id, event.type, null, null, "no_charge_id");
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

  if (facts.id !== objectId || facts.livemode !== false) {
    const r = await recordEvent(
      deps.db,
      event.id,
      event.type,
      objectId,
      null,
      "refused_mismatch_or_live",
    );
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }
  if (!isUuid(facts.conzPaymentId)) {
    const r = await recordEvent(deps.db, event.id, event.type, objectId, null, "no_conz_payment");
    return r.ok
      ? { status: 200, body: { received: true, outcome: r.outcome } }
      : { status: 500, body: { error: "db_error" } };
  }

  const applied = await applyPayonifyCharge(deps.db, facts.conzPaymentId, "ipn", event.id, facts);
  if (!applied.ok) {
    if (applied.notFound) {
      const r = await recordEvent(deps.db, event.id, event.type, objectId, null, "unknown_payment");
      return r.ok
        ? { status: 200, body: { received: true, outcome: r.outcome } }
        : { status: 500, body: { error: "db_error" } };
    }
    return { status: 500, body: { error: "db_error" } };
  }
  return { status: 200, body: { received: true, outcome: applied.outcome } };
}
