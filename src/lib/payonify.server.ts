// Server-only Payonify Relay client (test or live keys, per PAYONIFY_MODE). Never imported by client code.
// Wired to Con Z Pay by payonify.process.server.ts and payonify.functions.ts (0120).
//
// Built from the public docs at docs.payonify.com (read 26/10/2026):
//   - Base URL https://api.payonify.com, endpoints under /v1.
//   - HTTP Basic auth: base64(publishable_key:secret_key). Test keys pk_test_/sk_test_.
//   - Amounts are integers in the smallest unit (100 = $1.00); currency "usd" | "zwg".
//   - Charges: POST /v1/charges (min 100), GET /v1/charges/{id}.
//     Statuses: requires_payment_method, requires_authorization, pending, succeeded,
//     failed, cancelled.
//   - Relay transfers (EcoCash only): POST /v1/transfers with amount, currency,
//     application_fee_amount (our commission), description, destination.mobile_money.
//     ecocash.mobile_number. Returns 201 with status "pending"; final state comes from
//     the transfer.succeeded / transfer.failed webhook or GET /v1/transfers/{id}.
//   - POST /v1/transfers/validate, GET /v1/transfers/balance.
//   - Reversals: POST /v1/reversals {transfer, reason} -> "processing", then
//     reversal.succeeded / reversal.failed. Full amount only, once, only for a
//     succeeded transfer; our commission is reversed too. A reversal moves the
//     transfer back to our balance; it is NOT a refund to the customer.
//   - Webhooks: header Payonify-Signature "t=<unix>,v1=<hex>", HMAC-SHA256 over
//     "<t>.<raw body>" with the webhook secret, 5-minute tolerance, delivered more
//     than once (dedupe by event id).
//
// 27/10: docs.payonify.com/idempotence documents an Idempotency-Key header for POSTs; payouts
// (payonify.payouts.server.ts) send one per payout row and reuse it on every attempt. Still not
// documented: transfer metadata, the exact hold before charge funds become "available".
//
// Nothing here changes money in ConZ's database; apply_payonify_charge (0120) does, and only
// for charges re-fetched from this API. Transfers/reversals are not wired to anything yet.

const API_BASE = "https://api.payonify.com/v1";
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const REQUEST_TIMEOUT_MS = 20_000;

export type PayonifyCurrency = "usd" | "zwg";

export type PayonifyMode = "test" | "live";

export type PayonifyConfig = {
  publishableKey: string;
  secretKey: string;
  webhookSecret?: string;
  /** Which Payonify mode the keys belong to. Defaults to "test". */
  mode?: PayonifyMode;
};

export class PayonifyError extends Error {
  constructor(
    message: string,
    readonly status: number, // HTTP status; 0 = no response (timeout / network)
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PayonifyError";
  }
}

/**
 * True only when Payonify answered and clearly refused the request (a 4xx other than
 * timeout, conflict or rate limit), so nothing was created. Anything else (no response,
 * 5xx, 408/409/429) is unclear: the charge may exist, so look it up before trying again.
 */
export function isDefinitiveRejection(err: unknown): boolean {
  if (!(err instanceof PayonifyError)) return false;
  return err.status >= 400 && err.status < 500 && ![408, 409, 429].includes(err.status);
}

/** Payonify shows livemode as a boolean or as the string "true"/"false". Anything else is unknown. */
export function parseLivemode(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

/**
 * Reads PAYONIFY_* from the server environment. Returns null when not configured.
 * The keys must belong to the requested mode (pk_test_/sk_test_ or pk_live_/sk_live_): a
 * live key in a test setup, or the reverse, is a configuration error and is refused.
 */
export function getPayonifyConfig(
  env: Record<string, string | undefined> = process.env,
  mode: PayonifyMode = "test",
): PayonifyConfig | null {
  const publishableKey = env["PAYONIFY_PUBLISHABLE_KEY"]?.trim();
  const secretKey = env["PAYONIFY_SECRET_KEY"]?.trim();
  if (!publishableKey || !secretKey) return null;
  if (!publishableKey.startsWith(`pk_${mode}_`) || !secretKey.startsWith(`sk_${mode}_`)) {
    throw new Error(
      `Payonify keys don't match PAYONIFY_MODE=${mode}: use pk_${mode}_/sk_${mode}_ keys.`,
    );
  }
  const webhookSecret = env["PAYONIFY_WEBHOOK_SECRET"]?.trim() || undefined;
  return { publishableKey, secretKey, webhookSecret, mode };
}

/** Decimal dollars (as stored in ConZ, numeric(12,2)) to integer cents, exactly. */
export function toMinorUnits(amount: number | string): number {
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error("Invalid amount");
  const [whole, frac = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("Invalid amount");
  return cents;
}

/** Zimbabwe mobile number to the 9-digit form the docs use (e.g. 772111111). */
export function toEcocashNumber(input: string): string {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("263") ? digits.slice(3) : digits.replace(/^0/, "");
  if (!/^7[1-8]\d{7}$/.test(local)) throw new Error("Enter a valid Zimbabwe mobile number");
  return local;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function basicAuth(cfg: PayonifyConfig): string {
  return `Basic ${btoa(`${cfg.publishableKey}:${cfg.secretKey}`)}`;
}

async function call<T>(
  cfg: PayonifyConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  fetchImpl: FetchLike = fetch,
  idempotencyKey?: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: basicAuth(cfg),
        "Content-Type": "application/json",
        Accept: "application/json",
        // docs.payonify.com/idempotence: a retried POST with the same key creates nothing new.
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Timeout or network failure: the request may or may not have reached Payonify.
    throw new PayonifyError("Payonify could not be reached", 0, "network_error");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    // Never echo keys or the request body into logs or messages.
    throw new PayonifyError(
      err?.message ?? `Payonify request failed (${res.status})`,
      res.status,
      err?.code ?? null,
    );
  }
  return json as T;
}

export type TransferStatus = "pending" | "succeeded" | "failed";
export type Transfer = {
  id: string;
  object: "transfer";
  /** Docs show {value, currency}; older examples a plain integer. */
  amount: { value: number; currency: PayonifyCurrency } | number;
  net_amount: { value: number; currency: PayonifyCurrency } | number | null;
  application_fee_amount: number;
  status: TransferStatus | string;
  livemode: boolean | string;
  created: number;
  description: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

export type ChargeStatus =
  | "requires_payment_method"
  | "requires_authorization"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled";
/** A charge as Payonify returns it (docs: amount is an object {value, currency}). */
export type Charge = {
  id: string;
  object: "charge";
  amount: { value: number; currency: PayonifyCurrency } | number;
  currency?: PayonifyCurrency;
  status: ChargeStatus | string;
  livemode: boolean | string;
  paid?: boolean;
  failure_code?: string | null;
  failure_reason?: string | null;
  metadata?: Record<string, string> | null;
};

/** The fields ConZ checks, in one shape. Missing or malformed fields come back null. */
export type ChargeFacts = {
  id: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  livemode: boolean | null;
  conzPaymentId: string | null;
  failureCode: string | null;
};

export function chargeFacts(charge: Charge): ChargeFacts {
  const amt = charge.amount as unknown;
  let amountMinor: number | null = null;
  let currency: string | null = null;
  if (amt && typeof amt === "object") {
    const o = amt as { value?: unknown; currency?: unknown };
    amountMinor = Number.isInteger(o.value) ? (o.value as number) : null;
    currency = typeof o.currency === "string" ? o.currency : null;
  } else if (Number.isInteger(amt)) {
    amountMinor = amt as number;
  }
  if (!currency && typeof charge.currency === "string") currency = charge.currency;
  const meta = charge.metadata && typeof charge.metadata === "object" ? charge.metadata : null;
  return {
    id: String(charge.id ?? ""),
    status: typeof charge.status === "string" ? charge.status : "",
    amountMinor,
    currency,
    livemode: parseLivemode(charge.livemode),
    conzPaymentId: typeof meta?.conz_payment_id === "string" ? meta.conz_payment_id : null,
    failureCode: typeof charge.failure_code === "string" ? charge.failure_code : null,
  };
}

export function createEcocashCharge(
  cfg: PayonifyConfig,
  args: {
    amountMinor: number;
    currency: PayonifyCurrency;
    mobileNumber: string;
    description: string;
    metadata?: Record<string, string>;
  },
  fetchImpl?: FetchLike,
): Promise<Charge> {
  if (!Number.isInteger(args.amountMinor) || args.amountMinor < 100) {
    throw new Error("A charge must be at least 100 (one unit).");
  }
  if (args.metadata && Object.keys(args.metadata).length > 5)
    throw new Error("At most 5 metadata keys");
  return call<Charge>(
    cfg,
    "POST",
    "/charges",
    {
      amount: args.amountMinor,
      currency: args.currency,
      source: "web",
      description: args.description.slice(0, 150),
      payment_method: {
        mobile_money: { ecocash: { mobile_number: toEcocashNumber(args.mobileNumber) } },
      },
      metadata: args.metadata,
      confirm: true,
    },
    fetchImpl,
  );
}

export const getCharge = (cfg: PayonifyConfig, id: string, fetchImpl?: FetchLike) =>
  call<Charge>(cfg, "GET", `/charges/${encodeURIComponent(id)}`, undefined, fetchImpl);

export const getRelayBalance = (cfg: PayonifyConfig, fetchImpl?: FetchLike) =>
  call<{
    object: "balance";
    livemode: boolean;
    balances: Array<{
      provider: string;
      currency: PayonifyCurrency;
      available: number;
      pending: number;
      reserved: number;
    }>;
  }>(cfg, "GET", "/transfers/balance", undefined, fetchImpl);

export const validateEcocashRecipient = (
  cfg: PayonifyConfig,
  mobileNumber: string,
  fetchImpl?: FetchLike,
) =>
  call<{
    valid: boolean;
    recipient: { first_name: string; last_name: string; account_status: string };
  }>(
    cfg,
    "POST",
    "/transfers/validate",
    { mobile_money: { ecocash: { mobile_number: toEcocashNumber(mobileNumber) } } },
    fetchImpl,
  );

/**
 * Sends a Relay transfer. Returns the provider's record, normally "pending": that is
 * NOT a completed payout. Do not retry on an unclear failure without first checking
 * listTransfers, because Payonify documents no idempotency for this call.
 */
export function createTransfer(
  cfg: PayonifyConfig,
  args: {
    amountMinor: number;
    commissionMinor: number;
    currency: PayonifyCurrency;
    mobileNumber: string;
    description: string;
    /** Reuse the same key for every attempt of one payout. */
    idempotencyKey?: string;
  },
  fetchImpl?: FetchLike,
): Promise<Transfer> {
  const { amountMinor, commissionMinor } = args;
  if (!Number.isInteger(amountMinor) || amountMinor < 1) throw new Error("Invalid transfer amount");
  if (!Number.isInteger(commissionMinor) || commissionMinor < 0)
    throw new Error("Invalid commission");
  return call<Transfer>(
    cfg,
    "POST",
    "/transfers",
    {
      amount: amountMinor,
      currency: args.currency,
      application_fee_amount: commissionMinor,
      description: args.description.slice(0, 150),
      destination: {
        mobile_money: { ecocash: { mobile_number: toEcocashNumber(args.mobileNumber) } },
      },
    },
    fetchImpl,
    args.idempotencyKey,
  );
}

function minorOf(v: unknown): number | null {
  if (v && typeof v === "object") {
    const n = (v as { value?: unknown }).value;
    return Number.isInteger(n) ? (n as number) : null;
  }
  return Number.isInteger(v) ? (v as number) : null;
}

export type TransferFacts = {
  id: string;
  status: string;
  amountMinor: number | null;
  netMinor: number | null;
  livemode: boolean | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export function transferFacts(t: Transfer): TransferFacts {
  return {
    id: String(t.id ?? ""),
    status: typeof t.status === "string" ? t.status : "",
    amountMinor: minorOf(t.amount),
    netMinor: minorOf(t.net_amount),
    livemode: parseLivemode(t.livemode),
    failureCode: typeof t.failure_code === "string" ? t.failure_code : null,
    failureMessage: typeof t.failure_message === "string" ? t.failure_message : null,
  };
}

export const getTransfer = (cfg: PayonifyConfig, id: string, fetchImpl?: FetchLike) =>
  call<Transfer>(cfg, "GET", `/transfers/${encodeURIComponent(id)}`, undefined, fetchImpl);

export const createReversal = (
  cfg: PayonifyConfig,
  transferId: string,
  reason: string,
  fetchImpl?: FetchLike,
) =>
  call<{ id: string; status: "processing" | "succeeded" | "failed"; transfer: string }>(
    cfg,
    "POST",
    "/reversals",
    { transfer: transferId, reason: reason.slice(0, 150) },
    fetchImpl,
  );

// --- Webhooks -------------------------------------------------------------

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPayonifyPayload(
  secret: string,
  timestamp: number,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)),
  );
}

export type PayonifyEvent = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

/**
 * Verifies the Payonify-Signature header against the RAW request body and returns the
 * parsed event, or null if the signature, timestamp or body is wrong, or the event is from
 * the other mode (expectedLivemode). Callers must still dedupe by
 * event.id and re-fetch the object from the API before acting on it.
 */
export async function verifyPayonifyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  expectedLivemode = false,
): Promise<PayonifyEvent | null> {
  if (!header || !secret) return null;
  const parts = new Map<string, string[]>();
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) continue;
    const k = piece.slice(0, i).trim();
    parts.set(k, [...(parts.get(k) ?? []), piece.slice(i + 1).trim()]);
  }
  const t = Number(parts.get("t")?.[0]);
  const sigs = parts.get("v1") ?? [];
  if (!Number.isInteger(t) || sigs.length === 0) return null;
  if (Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) return null;
  const expected = await signPayonifyPayload(secret, t, rawBody);
  if (!sigs.some((s) => timingSafeEqualHex(s.toLowerCase(), expected))) return null;
  try {
    const event = JSON.parse(rawBody) as Omit<PayonifyEvent, "livemode"> & { livemode: unknown };
    if (typeof event?.id !== "string" || typeof event?.type !== "string") return null;
    // An event from the other mode (test vs live), or of unclear mode, is refused.
    if (parseLivemode(event.livemode) !== expectedLivemode) return null;
    if (!event.data || typeof event.data.object !== "object" || event.data.object === null)
      return null;
    return { ...event, livemode: expectedLivemode };
  } catch {
    return null;
  }
}
