// Bridges the native OAuth redirect back into the web app.
//
// auth.tsx opens Google sign-in in the system browser (required — Google
// blocks OAuth inside embedded WebViews) with the redirect target set to
// the custom scheme com.conz.app://oauth-callback. Android hands that URL
// to this listener via the Capacitor App plugin's appUrlOpen event. From
// there we just need to get the WebView showing the same URL shape the
// existing web /oauth-callback page already knows how to handle — it
// works purely by polling supabase.auth.getSession() and relying on the
// Supabase client's own automatic URL-based session detection at load
// time, so reconstructing the equivalent https:// URL and navigating the
// WebView there reuses that logic completely unchanged.

import { Capacitor } from "@capacitor/core";
import { SITE_URL } from "@/lib/site";

const PROD_ORIGIN = SITE_URL;
const CUSTOM_SCHEME_PREFIX = "com.conz.app://oauth-callback";

export function isNativePlatform(): boolean {
  // @capacitor/core is safe to import in web builds too -- this is the
  // designed cross-platform usage, it just returns false there. No lazy
  // loading needed for this one, unlike the native-only plugin packages
  // below (@capacitor/app, @capacitor/browser), which are dynamically
  // imported only when actually running on native.
  return Capacitor.isNativePlatform();
}

/**
 * Call once at app startup (native only). No-ops on web.
 */
export async function registerOAuthRedirectListener() {
  if (!isNativePlatform()) return;

  const { App } = await import("@capacitor/app");
  const { Browser } = await import("@capacitor/browser");

  App.addListener("appUrlOpen", async ({ url }) => {
    if (!url.startsWith(CUSTOM_SCHEME_PREFIX)) return;

    try {
      await Browser.close();
    } catch {
      /* system browser may already be closed/closing — fine either way */
    }

    // Everything after the custom-scheme prefix (query string and/or
    // hash fragment, depending on Supabase's flow type) carries the auth
    // code or tokens. Preserve it exactly, just swap the origin.
    const rest = url.slice(CUSTOM_SCHEME_PREFIX.length);
    window.location.href = `${PROD_ORIGIN}/oauth-callback${rest}`;
  });
}
