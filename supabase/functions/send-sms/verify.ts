// Pure helpers for the send-sms Auth hook (no Deno APIs, so they are unit
// tested with Vitest: tests/unit/send-sms.verify.test.ts).

const MAX_SKEW_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/**
 * Standard Webhooks signature check used by Supabase Auth hooks:
 * base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)), header
 * "v1,<sig> v1,<sig2> ...". Also rejects timestamps more than 5 minutes
 * away from now (replay protection).
 */
export async function verifyStandardWebhook(
  headers: WebhookHeaders,
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;

  const secretKey = secret.startsWith("v1,") ? secret.slice(3) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secretKey.replace(/^whsec_/, ""));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`));
  const expected = bytesToBase64(sig);
  return signature
    .split(" ")
    .map((s) => s.split(",")[1])
    .filter(Boolean)
    .some((candidate) => timingSafeEqual(candidate, expected));
}

/**
 * Normalise to E.164 and allow only configured country codes (default: 263,
 * Zimbabwe). Limits SMS-pumping / toll fraud to premium international ranges.
 */
export function allowedDestination(phone: string, allowedCountryCodes: string[]): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 9 || digits.length > 15) return null;
  if (!allowedCountryCodes.some((cc) => cc && digits.startsWith(cc))) return null;
  return `+${digits}`;
}
