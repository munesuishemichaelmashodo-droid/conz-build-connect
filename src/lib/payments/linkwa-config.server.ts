// When the Linkwa SANDBOX integration may run. Server only. Fails closed: any doubt means "off".
//
// It runs only when ALL of these hold:
//  * LINKWA_MODE is exactly "sandbox" and this is not a Vercel production deployment;
//  * Linkwa's base URL is exactly the sandbox URL (no production host, no other host);
//  * the database is NOT production (ovwrsocjmkpiygipmrdk) in any Supabase setting this server sees, and IS on the
//    allow-list: the staging project or a local database. Ordinary Vercel Preview deployments use the production
//    database, so they are refused here even if Linkwa variables were ever added to them;
//  * the API key is a SANDBOX key (Linkwa: "sk_sandbox_" keys run in isolated simulation mode, "sk_live_" keys move
//    real money) and the webhook signing secret is set. The signature is hex HMAC-SHA256 of the raw body (Linkwa's
//    webhook documentation: PHP hash_hmac('sha256', $rawBody, $secret), whose default output is lowercase hex);
//  * the request/response mapping (linkwa-protocol.ts) is present.
// Variable names only; values are never logged or returned.

import type { SignatureEncoding } from "@/lib/payments/hmac.server";
import { getLinkwaProtocol, type LinkwaProtocol } from "@/lib/payments/linkwa-protocol";

export const PRODUCTION_SUPABASE_REF = "ovwrsocjmkpiygipmrdk";
export const STAGING_SUPABASE_REF = "fpckydgssuefzzxivvig";
export const LINKWA_SANDBOX_BASE_URL = "https://sandbox.linkwa.co.zw/api/v1/third-party";

const ALLOWED_DATABASES = new Set([STAGING_SUPABASE_REF, "local"]);

export type LinkwaSandboxConfig = {
  baseUrl: string;
  apiKey: string;
  webhookSecret: string;
  signatureEncoding: SignatureEncoding;
  protocol: LinkwaProtocol;
};

export type LinkwaRefusal =
  | "not_sandbox"
  | "production_deployment"
  | "production_database"
  | "database_not_allowed"
  | "not_sandbox_host"
  | "missing_credentials"
  | "not_sandbox_key"
  | "protocol_not_documented";

type Env = Record<string, string | undefined>;

/** "local" for localhost, the 20-letter project ref for *.supabase.co, otherwise null. */
export function supabaseTarget(url: string | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return "local";
  const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  return m ? m[1] : null;
}

export function linkwaSandboxConfig(
  env: Env = process.env,
  protocol: LinkwaProtocol | null = getLinkwaProtocol(),
): { ok: true; config: LinkwaSandboxConfig } | { ok: false; reason: LinkwaRefusal } {
  // Production checks first, so production is refused whatever else is configured.
  const urls = [env.SUPABASE_URL, env.VITE_SUPABASE_URL];
  const refs = urls.map(supabaseTarget);
  if (
    refs.includes(PRODUCTION_SUPABASE_REF) ||
    env.VITE_SUPABASE_PROJECT_ID === PRODUCTION_SUPABASE_REF ||
    urls.some((u) => (u ?? "").includes(PRODUCTION_SUPABASE_REF))
  ) {
    return { ok: false, reason: "production_database" };
  }
  if (env.VERCEL_ENV === "production") return { ok: false, reason: "production_deployment" };
  if (env.LINKWA_MODE !== "sandbox") return { ok: false, reason: "not_sandbox" };

  // The server database must be named and allowed; a browser setting, if present, must be allowed too.
  const server = refs[0];
  if (!server || !ALLOWED_DATABASES.has(server))
    return { ok: false, reason: "database_not_allowed" };
  if (env.VITE_SUPABASE_URL && (!refs[1] || !ALLOWED_DATABASES.has(refs[1]))) {
    return { ok: false, reason: "database_not_allowed" };
  }

  const baseUrl = env.LINKWA_BASE_URL ?? LINKWA_SANDBOX_BASE_URL;
  if (baseUrl !== LINKWA_SANDBOX_BASE_URL) return { ok: false, reason: "not_sandbox_host" };

  const apiKey = env.LINKWA_API_KEY ?? "";
  const webhookSecret = env.LINKWA_WEBHOOK_SECRET ?? "";
  if (!apiKey.trim() || !webhookSecret.trim()) return { ok: false, reason: "missing_credentials" };
  if (!apiKey.startsWith("sk_sandbox_")) return { ok: false, reason: "not_sandbox_key" };

  if (!protocol) return { ok: false, reason: "protocol_not_documented" };

  return {
    ok: true,
    config: { baseUrl, apiKey, webhookSecret, signatureEncoding: "hex", protocol },
  };
}

// -----------------------------------------------------------------------------------------------------------------
// Second credential: Linkwa DEVELOPER API key (Developer plan), for user registration, wallet linking and payouts.
//
// Linkwa has two key types (Developer API page, "Authentication"):
//   * Integration Key (Growth plan): "Can only create payment links and check payment status" -> LINKWA_API_KEY
//     (unchanged; used by collection, status checks and the admin re-check).
//   * Developer API Key (Developer plan): "Full programmatic access: create payment links, manage wallets, instruct
//     payouts, query balances and statements" -> LINKWA_DEVELOPER_API_KEY (this config).
// The two are never interchanged: collection never uses the developer key, and user/wallet/payout calls never use
// the integration key. The developer key gets EVERY sandbox guard above (staging/local database only, no production
// deployment, sandbox host only, LINKWA_MODE=sandbox, "sk_sandbox_" key). It MAY equal LINKWA_API_KEY: one Developer
// app key can do both collection and payouts (Linkwa: "Full programmatic access"), and Linkwa itself refuses a
// non-developer key on these endpoints (sandbox evidence T0, 25/11: HTTP 403 "This endpoint requires a Developer API Key.").
// Nothing here enables payouts in the product: provider_marketplace_settlement and payouts_enabled stay off.
// -----------------------------------------------------------------------------------------------------------------

export type LinkwaDeveloperConfig = { baseUrl: string; apiKey: string };

export type LinkwaDeveloperRefusal =
  | Exclude<LinkwaRefusal, "missing_credentials" | "not_sandbox_key" | "protocol_not_documented">
  | "missing_developer_key"
  | "developer_key_not_sandbox";

export function linkwaDeveloperConfig(
  env: Env = process.env,
): { ok: true; config: LinkwaDeveloperConfig } | { ok: false; reason: LinkwaDeveloperRefusal } {
  const urls = [env.SUPABASE_URL, env.VITE_SUPABASE_URL];
  const refs = urls.map(supabaseTarget);
  if (
    refs.includes(PRODUCTION_SUPABASE_REF) ||
    env.VITE_SUPABASE_PROJECT_ID === PRODUCTION_SUPABASE_REF ||
    urls.some((u) => (u ?? "").includes(PRODUCTION_SUPABASE_REF))
  ) {
    return { ok: false, reason: "production_database" };
  }
  if (env.VERCEL_ENV === "production") return { ok: false, reason: "production_deployment" };
  if (env.LINKWA_MODE !== "sandbox") return { ok: false, reason: "not_sandbox" };

  const server = refs[0];
  if (!server || !ALLOWED_DATABASES.has(server))
    return { ok: false, reason: "database_not_allowed" };
  if (env.VITE_SUPABASE_URL && (!refs[1] || !ALLOWED_DATABASES.has(refs[1]))) {
    return { ok: false, reason: "database_not_allowed" };
  }

  const baseUrl = env.LINKWA_BASE_URL ?? LINKWA_SANDBOX_BASE_URL;
  if (baseUrl !== LINKWA_SANDBOX_BASE_URL) return { ok: false, reason: "not_sandbox_host" };

  const apiKey = (env.LINKWA_DEVELOPER_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, reason: "missing_developer_key" };
  if (!apiKey.startsWith("sk_sandbox_")) return { ok: false, reason: "developer_key_not_sandbox" };
  return { ok: true, config: { baseUrl, apiKey } };
}
