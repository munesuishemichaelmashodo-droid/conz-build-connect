// Linkwa DEVELOPER API client (sandbox only). Server only. Built only from linkwaDeveloperConfig() (linkwa-config.server.ts),
// which refuses the production database, production deployments, live keys, non-sandbox hosts, and a developer key that
// equals the collection (Integration) key.
//
// Documented operations only (Linkwa Developer API page + Postman collection, docs/payments/linkwa/), base
// {sandbox}/api/v1/third-party, header Authorization: Bearer <developer key>:
//   1  POST /users     {first_name, last_name, phone_number, email}        -> {message, user:{..., external_user_id}}
//   2  POST /wallets   {external_user_id, phone_number}  (JSON form ONLY)   -> {message, wallet:{external_wallet_id, provider, phone_number}}
//      The multipart registration form (ID number, date of birth, ID picture) is deliberately NOT implemented: ConZ does
//      not collect identity documents. A 422 {requires_registration:true} is reported as it is.
//   5  GET  /balance                                                       -> {balances:[{currency, available_balance, pending_balance}]}
//   6  GET  /statement?currency_code=USD&per_page=N                        -> {data:[...], meta:{...}}
//   7  POST /payouts   {external_user_id, external_wallet_id, amount, currency_code, include_balance_after}
//                                                                          -> {message, payout:{payout_id, amount, currency}, balance_after}
// A payout response means "instructed", never "paid": Linkwa documents no final payout status (see the contract doc).
//
// Every response is REDACTED before it leaves this file: names, emails and customer blocks are dropped and phone numbers
// are masked to their last 3 digits. Keys are never returned or logged.

import type { LinkwaDeveloperConfig } from "@/lib/payments/linkwa-config.server";

const TIMEOUT_MS = 20_000;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type LinkwaCallResult = {
  /** HTTP status Linkwa answered with; 0 when the request did not complete (timeout, network). */
  httpStatus: number;
  /** Linkwa's JSON body with personal data removed; null when not JSON. */
  body: unknown;
  /** Set when no answer arrived. A payout with no answer is UNKNOWN: it may or may not have been instructed. */
  transportError: "timeout" | "network" | null;
};

const DROP_KEYS = new Set([
  "account_holder_name",
  "address",
  "first_name",
  "last_name",
  "email",
  "customer",
  "full_name",
  "name",
  "id_number",
  "date_of_birth",
]);
const PHONE_KEYS = new Set(["phone_number", "phone", "msisdn", "account_number"]);

export function maskPhone(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const digits = v.replace(/\D/g, "");
  return digits.length <= 3 ? "***" : `***${digits.slice(-3)}`;
}

/** Removes personal data from a Linkwa response, recursively. */
export function redactLinkwa(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactLinkwa);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) {
        out[k] = "[redacted]";
      } else if (PHONE_KEYS.has(k)) {
        out[k] = maskPhone(val);
      } else {
        out[k] = redactLinkwa(val);
      }
    }
    return out;
  }
  return v;
}

export type LinkwaDeveloperClient = {
  linkUser(i: {
    firstName: string;
    lastName: string;
    phoneNumber: string;
    email: string;
  }): Promise<LinkwaCallResult>;
  linkWallet(i: { externalUserId: string; phoneNumber: string }): Promise<LinkwaCallResult>;
  instructPayout(i: {
    externalUserId: string;
    externalWalletId: string;
    amount: number;
  }): Promise<LinkwaCallResult>;
  getBalance(): Promise<LinkwaCallResult>;
  getStatement(perPage: number): Promise<LinkwaCallResult>;
};

export function createLinkwaDeveloperClient(
  cfg: LinkwaDeveloperConfig,
  fetchImpl: FetchLike = fetch,
): LinkwaDeveloperClient {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<LinkwaCallResult> {
    let res: Response;
    try {
      res = await fetchImpl(`${cfg.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      return {
        httpStatus: 0,
        body: null,
        transportError: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
      };
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { httpStatus: res.status, body: redactLinkwa(parsed), transportError: null };
  }

  return {
    linkUser: ({ firstName, lastName, phoneNumber, email }) =>
      call("POST", "/users", {
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber,
        email,
      }),
    linkWallet: ({ externalUserId, phoneNumber }) =>
      call("POST", "/wallets", { external_user_id: externalUserId, phone_number: phoneNumber }),
    instructPayout: ({ externalUserId, externalWalletId, amount }) => {
      if (!(Number.isFinite(amount) && amount > 0 && amount <= 1_000)) {
        throw new Error("Sandbox payout amount must be above 0 and at most 1000");
      }
      return call("POST", "/payouts", {
        external_user_id: externalUserId,
        external_wallet_id: externalWalletId,
        amount: Math.round(amount * 100) / 100,
        currency_code: "USD",
        include_balance_after: true,
      });
    },
    getBalance: () => call("GET", "/balance"),
    getStatement: (perPage) =>
      call(
        "GET",
        `/statement?currency_code=USD&per_page=${Math.min(Math.max(Math.trunc(perPage) || 10, 1), 25)}`,
      ),
  };
}

// ----------------------------------------------------------------------------------------------- console input checks

export const LINKWA_SANDBOX_ACTIONS = [
  "link_user",
  "link_wallet",
  "payout",
  "balance",
  "statement",
] as const;
export type LinkwaSandboxAction = (typeof LINKWA_SANDBOX_ACTIONS)[number];

export type LinkwaSandboxCallInput = {
  action: LinkwaSandboxAction;
  reason: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  email?: string;
  externalUserId?: string;
  externalWalletId?: string;
  amount?: number;
};

const PHONE_RE = /^2637\d{8}$/; // Linkwa's documented international format, e.g. 263771234567
const ID_RE = /^[A-Za-z0-9_-]{3,100}$/;
const NAME_RE = /^[\p{L}' -]{1,60}$/u;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,20}$/;

/** Returns a clean input, or a short reason why it was refused. */
export function validateSandboxCall(
  i: Partial<LinkwaSandboxCallInput> | null | undefined,
): { ok: true; value: LinkwaSandboxCallInput } | { ok: false; error: string } {
  if (!i || !LINKWA_SANDBOX_ACTIONS.includes(i.action as LinkwaSandboxAction)) {
    return { ok: false, error: "unknown_action" };
  }
  const reason = typeof i.reason === "string" ? i.reason.trim() : "";
  if (reason.length < 5 || reason.length > 300) return { ok: false, error: "reason_required" };
  const base = { action: i.action as LinkwaSandboxAction, reason };
  switch (base.action) {
    case "link_user": {
      const firstName = (i.firstName ?? "").trim();
      const lastName = (i.lastName ?? "").trim();
      const email = (i.email ?? "").trim();
      const phoneNumber = (i.phoneNumber ?? "").trim();
      if (!NAME_RE.test(firstName) || !NAME_RE.test(lastName))
        return { ok: false, error: "bad_name" };
      if (!EMAIL_RE.test(email)) return { ok: false, error: "bad_email" };
      // T1e deliberately sends an invalid phone to see Linkwa's 422, so only length is limited here.
      if (phoneNumber.length < 1 || phoneNumber.length > 20)
        return { ok: false, error: "bad_phone" };
      return { ok: true, value: { ...base, firstName, lastName, email, phoneNumber } };
    }
    case "link_wallet": {
      const externalUserId = (i.externalUserId ?? "").trim();
      const phoneNumber = (i.phoneNumber ?? "").trim();
      if (!ID_RE.test(externalUserId)) return { ok: false, error: "bad_external_user_id" };
      if (!PHONE_RE.test(phoneNumber)) return { ok: false, error: "bad_phone" };
      return { ok: true, value: { ...base, externalUserId, phoneNumber } };
    }
    case "payout": {
      const externalUserId = (i.externalUserId ?? "").trim();
      const externalWalletId = (i.externalWalletId ?? "").trim();
      const amount = Number(i.amount);
      if (!ID_RE.test(externalUserId)) return { ok: false, error: "bad_external_user_id" };
      if (!ID_RE.test(externalWalletId)) return { ok: false, error: "bad_external_wallet_id" };
      if (!(Number.isFinite(amount) && amount > 0 && amount <= 1_000))
        return { ok: false, error: "bad_amount" };
      return { ok: true, value: { ...base, externalUserId, externalWalletId, amount } };
    }
    default:
      return { ok: true, value: base };
  }
}
