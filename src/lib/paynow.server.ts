// Server-only Paynow (Zimbabwe) helpers. Never imported by client code.

const INITIATE_URL = "https://www.paynow.co.zw/interface/initiatetransaction";

export function getPaynowCredentials(): { id: string; key: string } | null {
  const id = process.env["PAYNOW_INTEGRATION_ID"]?.trim();
  const key = process.env["PAYNOW_INTEGRATION_KEY"]?.trim();
  if (!id || !key) return null;
  // Safe diagnostic: masked lengths/edges only, never the full key.
  console.log(
    `[Paynow] creds loaded — id="${id}" (len ${id.length}), key len ${key.length}, key starts "${key.slice(0, 3)}..." ends "...${key.slice(-3)}"`,
  );
  return { id, key };
}

/**
 * Paynow hash: concatenate every field value (in order, excluding `hash`),
 * append the integration key, SHA-512, uppercase hex.
 */
export async function paynowHash(values: string[], integrationKey: string): Promise<string> {
  const raw = values.join("") + integrationKey;
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function parsePaynowResponse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body).entries()) out[k.toLowerCase()] = v;
  return out;
}

/**
 * Verify an inbound IPN / status payload. The hash is computed over all
 * fields except `hash`, in the order Paynow sent them.
 */
export async function verifyPaynowPayload(
  fields: Array<[string, string]>,
  integrationKey: string,
): Promise<boolean> {
  const received = fields.find(([k]) => k.toLowerCase() === "hash")?.[1];
  if (!received) return false;
  const values = fields.filter(([k]) => k.toLowerCase() !== "hash").map(([, v]) => v);
  const expected = await paynowHash(values, integrationKey);
  return expected === received.toUpperCase();
}

export type PollResult = { ok: true; status: string; paynowReference?: string } | { ok: false; error: string };

/**
 * Actively check a payment's status via Paynow's poll URL (returned at
 * initiation). Used as the primary reconciliation path since the resultUrl
 * webhook is not always reliably delivered, especially in test mode.
 */
export async function pollPaynowStatus(pollUrl: string): Promise<PollResult> {
  const creds = getPaynowCredentials();
  if (!creds) return { ok: false, error: "paynow_not_configured" };
  let res: Response;
  try {
    res = await fetch(pollUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, error: timedOut ? "paynow_timeout" : "paynow_unreachable" };
  }
  const text = await res.text();
  const fields: Array<[string, string]> = [...new URLSearchParams(text).entries()];
  const valid = await verifyPaynowPayload(fields, creds.key);
  if (!valid) return { ok: false, error: "invalid_hash" };
  const map = parsePaynowResponse(text);
  return { ok: true, status: (map["status"] ?? "").toLowerCase(), paynowReference: map["paynowreference"] };
}

export type InitiateResult =
  | { ok: true; browserUrl: string; pollUrl: string }
  | { ok: false; error: string };

export async function initiatePaynowTransaction(args: {
  reference: string;
  amount: number;
  authEmail: string;
  returnUrl: string;
  resultUrl: string;
  additionalInfo: string;
}): Promise<InitiateResult> {
  const creds = getPaynowCredentials();
  if (!creds) return { ok: false, error: "paynow_not_configured" };

  // Field order matters — the hash is built from these values in this order.
  const fields: Array<[string, string]> = [
    ["id", creds.id],
    ["reference", args.reference],
    ["amount", args.amount.toFixed(2)],
    ["additionalinfo", args.additionalInfo],
    ["returnurl", args.returnUrl],
    ["resulturl", args.resultUrl],
    ["authemail", args.authEmail],
    ["status", "Message"],
  ];
  const hash = await paynowHash(
    fields.map(([, v]) => v),
    creds.key,
  );
  console.log(`[Paynow] computed hash starts "${hash.slice(0, 6)}..."`);

  const body = new URLSearchParams([...fields, ["hash", hash]]).toString();

  let res: Response;
  try {
    res = await fetch(INITIATE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, error: timedOut ? "paynow_timeout" : "paynow_unreachable" };
  }
  const text = await res.text();
  const parsed = parsePaynowResponse(text);
  console.log(`[Paynow] response status="${parsed["status"]}" error="${parsed["error"] ?? ""}"`);

  if ((parsed["status"] ?? "").toLowerCase() !== "ok") {
    return { ok: false, error: parsed["error"] || "paynow_rejected" };
  }
  if (!parsed["browserurl"] || !parsed["pollurl"]) {
    return { ok: false, error: "paynow_bad_response" };
  }
  return { ok: true, browserUrl: parsed["browserurl"], pollUrl: parsed["pollurl"] };
}
