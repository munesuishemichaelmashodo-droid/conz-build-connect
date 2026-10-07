// Server-only Paynow (Zimbabwe) helpers. Never imported by client code.
//
// Security model (audit F3): every Paynow message is untrusted until its
// SHA-512 hash verifies against the integration key. Even then, this code
// never decides what happens to money — it hands the verified fields to the
// database function apply_paynow_result(), which checks the reference and
// amount against the stored payment and enforces the payment state machine
// (no double credit, no regression, anomalies flagged to admins).

const INITIATE_URL = "https://www.paynow.co.zw/interface/initiatetransaction";

// Poll URLs are stored server-side from Paynow's own initiate response, but
// they are still fetched by the server, so only Paynow hosts are allowed.
const PAYNOW_HOSTS = new Set(["www.paynow.co.zw", "paynow.co.zw"]);

export function getPaynowCredentials(): { id: string; key: string } | null {
  const id = process.env["PAYNOW_INTEGRATION_ID"]?.trim();
  const key = process.env["PAYNOW_INTEGRATION_KEY"]?.trim();
  if (!id || !key) return null;
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

/** Length-independent-time string comparison (no early exit on mismatch). */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Parse a Paynow form-encoded body into ordered fields. Returns null when a
 * key appears twice: a duplicated field could make the hashed value and the
 * value we act on differ.
 */
export function parsePaynowFields(body: string): Array<[string, string]> | null {
  const fields: Array<[string, string]> = [...new URLSearchParams(body).entries()];
  const seen = new Set<string>();
  for (const [k] of fields) {
    const key = k.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
  }
  return fields;
}

export function fieldMap(fields: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fields) out[k.toLowerCase()] = v;
  return out;
}

export function parsePaynowResponse(body: string): Record<string, string> {
  return fieldMap([...new URLSearchParams(body).entries()]);
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
  return constantTimeEqual(expected, received.toUpperCase());
}

export function isAllowedPollUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PAYNOW_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Fields of a hash-verified Paynow status message that the DB needs. */
export type VerifiedPaynowResult = {
  status: string;
  amount: string | null;
  reference: string | null;
  paynowReference: string | null;
};

export type PollResult = ({ ok: true } & VerifiedPaynowResult) | { ok: false; error: string };

/**
 * Actively check a payment's status via Paynow's poll URL (returned at
 * initiation). Used by the reconcile job and as a fallback when the
 * resultUrl webhook is not delivered.
 */
export async function pollPaynowStatus(pollUrl: string): Promise<PollResult> {
  const creds = getPaynowCredentials();
  if (!creds) return { ok: false, error: "paynow_not_configured" };
  if (!isAllowedPollUrl(pollUrl)) return { ok: false, error: "poll_url_not_allowed" };
  let res: Response;
  try {
    res = await fetch(pollUrl, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, error: timedOut ? "paynow_timeout" : "paynow_unreachable" };
  }
  const text = await res.text();
  const fields = parsePaynowFields(text);
  if (!fields) return { ok: false, error: "duplicate_fields" };
  if (!(await verifyPaynowPayload(fields, creds.key))) return { ok: false, error: "invalid_hash" };
  return { ok: true, ...toVerifiedResult(fieldMap(fields)) };
}

export function toVerifiedResult(map: Record<string, string>): VerifiedPaynowResult {
  return {
    status: (map["status"] ?? "").trim(),
    amount: map["amount"] ?? null,
    reference: map["reference"] ?? null,
    paynowReference: map["paynowreference"] ?? null,
  };
}

/** Minimal surface of the service-role client used to apply a result. */
export type PaynowResultDb = {
  rpc: (
    fn: "apply_paynow_result",
    args: {
      _payment_id: string;
      _source: "ipn" | "poll" | "reconcile";
      _status: string;
      _reported_amount: string | null;
      _reported_reference: string | null;
      _paynow_reference: string | null;
    },
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type ApplyOutcome =
  | { ok: true; outcome: string; status: string }
  | { ok: false; error: "payment_not_found" | "db_error"; message?: string };

/**
 * Hand a hash-verified result to the database. The DB decides everything
 * (reference/amount/state checks, single credit, anomaly alerts).
 */
export async function applyPaynowResult(
  db: PaynowResultDb,
  paymentId: string,
  source: "ipn" | "poll" | "reconcile",
  result: VerifiedPaynowResult,
): Promise<ApplyOutcome> {
  const { data, error } = await db.rpc("apply_paynow_result", {
    _payment_id: paymentId,
    _source: source,
    _status: result.status,
    _reported_amount: result.amount,
    _reported_reference: result.reference,
    _paynow_reference: result.paynowReference,
  });
  if (error) {
    if (error.code === "P0002" || /payment_not_found/.test(error.message)) {
      return { ok: false, error: "payment_not_found" };
    }
    return { ok: false, error: "db_error", message: error.message };
  }
  const d = (data ?? {}) as { outcome?: string; status?: string };
  return { ok: true, outcome: d.outcome ?? "unknown", status: d.status ?? "unknown" };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Full IPN processing, independent of the HTTP framework so it can be unit
 * tested. Returns the HTTP status to send back to Paynow:
 *   200 — handled (including duplicates and rejected mismatches: retrying
 *         would not change the outcome, and the DB has recorded + alerted)
 *   400 — malformed; 401 — bad hash; 404 — unknown payment;
 *   502 — database failure, so Paynow retries (safe: the DB is idempotent)
 *   503 — Paynow not configured
 */
export async function processPaynowIpn(
  rawBody: string,
  deps: { integrationKey: string | null; db: PaynowResultDb },
): Promise<{ status: number; body: string }> {
  if (!deps.integrationKey) return { status: 503, body: "paynow_not_configured" };
  const fields = parsePaynowFields(rawBody);
  if (!fields || fields.length === 0) return { status: 400, body: "bad request" };
  if (!(await verifyPaynowPayload(fields, deps.integrationKey)))
    return { status: 401, body: "invalid hash" };

  const result = toVerifiedResult(fieldMap(fields));
  if (!result.reference || !UUID_RE.test(result.reference))
    return { status: 400, body: "missing reference" };

  const applied = await applyPaynowResult(deps.db, result.reference, "ipn", result);
  if (!applied.ok) {
    if (applied.error === "payment_not_found") return { status: 404, body: "unknown reference" };
    console.error(`[paynow-ipn] apply failed for ${result.reference}: ${applied.message ?? ""}`);
    return { status: 502, body: "processing_failed" };
  }
  return { status: 200, body: "ok" };
}

export type InitiateResult =
  { ok: true; browserUrl: string; pollUrl: string } | { ok: false; error: string };

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
  // Paynow's initiate response is itself signed; reject anything that does
  // not verify, and never store a poll URL outside Paynow's hosts.
  const respFields = parsePaynowFields(text);
  if (!respFields || !(await verifyPaynowPayload(respFields, creds.key))) {
    return { ok: false, error: "paynow_bad_signature" };
  }
  if (!isAllowedPollUrl(parsed["pollurl"])) {
    return { ok: false, error: "paynow_bad_poll_url" };
  }
  return { ok: true, browserUrl: parsed["browserurl"], pollUrl: parsed["pollurl"] };
}
