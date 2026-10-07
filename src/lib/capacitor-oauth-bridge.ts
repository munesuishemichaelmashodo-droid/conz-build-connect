// Bridges the native OAuth redirect back into the web app.
//
// auth.tsx opens Google sign-in in the system browser (required — Google
// blocks OAuth inside embedded WebViews) with the redirect target set to
// the custom scheme com.conz.app://oauth-callback. Android hands that URL
// to this listener via the Capacitor App plugin's appUrlOpen event.
//
// SECURITY (audit H8): a custom scheme can be claimed by any installed app,
// so the redirect must never carry usable credentials. Native sign-in uses
// a dedicated PKCE client (nativeOAuthClient): the redirect carries only a
// one-time code, and this listener exchanges it using the code verifier that
// the PKCE client stored in this WebView when sign-in started. An app that
// intercepts the redirect gets a code it cannot redeem. Token-bearing
// (implicit-flow) redirects are refused. The exchanged session is written to
// the same storage the main client uses, so /oauth-callback picks it up.

import { Capacitor } from "@capacitor/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/lib/site";
import { parseNativeOAuthCallback } from "@/lib/oauth-callback-url";

const PROD_ORIGIN = SITE_URL;

export function isNativePlatform(): boolean {
  // @capacitor/core is safe to import in web builds too -- this is the
  // designed cross-platform usage, it just returns false there. No lazy
  // loading needed for this one, unlike the native-only plugin packages
  // below (@capacitor/app, @capacitor/browser), which are dynamically
  // imported only when actually running on native.
  return Capacitor.isNativePlatform();
}

let _pkce: SupabaseClient | undefined;

/**
 * PKCE-flow client for native Google sign-in only. Shares the main client's
 * storage (same URL => same storage key), so the session it obtains is the
 * session the rest of the app sees.
 */
export function nativeOAuthClient(): SupabaseClient {
  if (!_pkce) {
    _pkce = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          flowType: "pkce",
          storage: typeof window !== "undefined" ? localStorage : undefined,
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return _pkce;
}

/**
 * Call once at app startup (native only). No-ops on web.
 */
export async function registerOAuthRedirectListener() {
  if (!isNativePlatform()) return;

  const { App } = await import("@capacitor/app");
  const { Browser } = await import("@capacitor/browser");

  App.addListener("appUrlOpen", async ({ url }) => {
    const parsed = parseNativeOAuthCallback(url);
    if (parsed.kind === "ignored") return;

    try {
      await Browser.close();
    } catch {
      /* system browser may already be closed/closing — fine either way */
    }

    if (parsed.kind === "code") {
      const { error } = await nativeOAuthClient().auth.exchangeCodeForSession(parsed.code);
      if (error) console.error("[oauth] code exchange failed:", error.message);
    } else if (parsed.kind === "tokens_refused") {
      console.error("[oauth] refused a token-bearing redirect (expected a PKCE code)");
    } else {
      console.error("[oauth] provider error:", parsed.message);
    }
    // Never forward anything from the redirect URL; /oauth-callback just
    // waits for the session (present after a successful exchange).
    window.location.href = `${PROD_ORIGIN}/oauth-callback`;
  });
}
