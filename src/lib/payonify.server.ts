// Server-only Payonify Relay client (SANDBOX ONLY). Never imported by client code.
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
// NOT documented, so this module does not assume them: an idempotency header,
// transfer metadata, the exact hold before charge funds become "available".
// Because a transfer POST cannot be made idempotent on Payonify's side, callers must
// never blindly retry createTransfer: record the intent first, and after an unclear
// failure look the transfer up (listTransfers) before sending another.
//
// Nothing here changes money in ConZ's database. Wiring it to jobs, the wallet or
// commission needs its own reviewed migration (see docs/payments/PAYONIFY-RELAY.md).

const API_BASE = "https://api.payonify.com/v1";
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type PayonifyCurrency = "usd" | "zwg";

export type PayonifyConfig = { publishableKey: string; secretKey: string; webhookSecret?: string };

export class PayonifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PayonifyError";
  }
}

/**
 * Reads PAYONIFY_* from the server environment. Returns null when not configured.
 * Live keys are refused: this integration is sandbox-only until the owner approves
 * live payments, so a live key in the environment is treated as a configuration error.
 */
export function getPayonifyConfig(
  env: Record<string, string | undefined> = process.env,
): PayonifyConfig | null {
  const publishableKey = env["PAYONIFY_PUBLISHABLE_KEY"]?.trim();
  const secretKey = env["PAYONIFY_SECRET_KEY"]?.trim();
  if (!publishableKey || !secretKey) return null;
  if (!publishableKey.startsWith("pk_test_") || !secretKey.startsWith("sk_test_")) {
    throw new Error("Payonify is sandbox-only: use pk_test_/sk_test_ keys.");
  }
  const webhookSecret = env["PAYONIFY_WEBHOOK_SECRET"]?.trim() || undefined;
  return { publishableKey, secretKey, webhookSecret };
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
): Promise<T> {
  const res = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  amount: number;
  net_amount: number;
  application_fee_amount: number;
  status: TransferStatus;
  livemode: boolean;
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
export type Charge = {
  id: string;
  object: "charge";
  amount: number;
  currency: PayonifyCurrency;
  status: ChargeStatus;
  livemode: boolean;
  metadata?: Record<string, string>;
};

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
  );
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
 * parsed event, or null if the signature, timestamp or body is wrong. Live-mode events
 * are rejected while the integration is sandbox-only. Callers must still dedupe by
 * event.id and re-fetch the object from the API before acting on it.
 */
export async function verifyPayonifyWebhook(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
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
    const event = JSON.parse(rawBody) as PayonifyEvent;
    if (typeof event?.id !== "string" || typeof event?.type !== "string") return null;
    if (event.livemode !== false) return null;
    return event;
  } catch {
    return null;
  }
}
