// When the Linkwa SANDBOX integration may run. Server only. Fails closed: any doubt means "off".
//
// It runs only when ALL of these hold:
//  * LINKWA_MODE is exactly "sandbox" and this is not a Vercel production deployment;
//  * Linkwa's base URL is exactly the sandbox URL (no production host, no other host);
//  * the database is NOT production (ovwrsocjmkpiygipmrdk) in any Supabase setting this server sees, and IS on the
//    allow-list: the staging project or a local database. Ordinary Vercel Preview deployments use the production
//    database, so they are refused here even if Linkwa variables were ever added to them;
//  * the API key, the webhook secret and the signature encoding (hex | base64, from Linkwa's documentation) are set;
//  * the request/response mapping has been written from Linkwa's documentation (linkwa-protocol.ts).
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
  | "signature_encoding_unset"
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

  const enc = env.LINKWA_SIGNATURE_ENCODING;
  if (enc !== "hex" && enc !== "base64") return { ok: false, reason: "signature_encoding_unset" };

  if (!protocol) return { ok: false, reason: "protocol_not_documented" };

  return { ok: true, config: { baseUrl, apiKey, webhookSecret, signatureEncoding: enc, protocol } };
}
