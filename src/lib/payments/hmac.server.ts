// HMAC-SHA256 webhook signature check over the RAW request body. Server only.
//
// The signature is recomputed from the exact bytes received (never from re-serialised JSON) and compared in
// constant time. The header's encoding (hex or base64) is configuration, not a guess: the caller passes the one the
// provider documents.

export type SignatureEncoding = "hex" | "base64";

const HEX_SHA256 = /^[0-9a-fA-F]{64}$/;
const B64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

function decodeSignature(value: string, encoding: SignatureEncoding): Uint8Array | null {
  const v = value.trim();
  if (encoding === "hex") {
    if (!HEX_SHA256.test(v)) return null;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (!B64_SHA256.test(v)) return null;
  const bin = atob(v);
  if (bin.length !== 32) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time comparison: the time taken does not depend on where the bytes first differ. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hmacSha256(secret: string, rawBody: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
}

/** True only when `header` is a well-formed HMAC-SHA256 of `rawBody` under `secret`. Never throws. */
export async function verifyHmacSha256(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  encoding: SignatureEncoding,
): Promise<boolean> {
  if (!header || !secret) return false;
  const given = decodeSignature(header, encoding);
  if (!given) return false;
  try {
    return constantTimeEqual(given, await hmacSha256(secret, rawBody));
  } catch {
    return false;
  }
}
