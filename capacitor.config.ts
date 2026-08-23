import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.conz.app',
  appName: 'Con Z',
  // This is a server-rendered app (TanStack Start + Nitro), not a static
  // site — server functions (Paynow, admin actions, etc.) run on Vercel and
  // can't be bundled into the phone. So instead of loading local files from
  // webDir, Capacitor is told to load the live deployed app directly. The
  // native shell exists to get Con Z onto the Play Store, give it an app
  // icon/splash screen, and get proper Android permission prompts for
  // camera/location — the actual app still runs against your real backend.
  webDir: 'dist/client',
  server: {
    // IMPORTANT: the live site redirects https://conz.co.zw -> https://www.conz.co.zw.
    // Confirmed via on-device diagnostics (a custom WebViewClient logging
    // onPageFinished): the WebView's very first load followed that redirect
    // and landed on www.conz.co.zw, a different origin than what was
    // configured here (bare conz.co.zw, not in allowNavigation either).
    // That mismatch is what caused the app to intermittently hand the page
    // off to Chrome instead of loading it in-app. Pointing server.url
    // directly at the real destination avoids the redirect happening
    // inside the WebView at all.
    url: 'https://www.conz.co.zw',
    cleartext: false,
    // Capacitor restricts in-WebView navigation to the server.url origin
    // by default. The Paynow payment flow navigates the same WebView
    // (window.location.href, not a new tab) to Paynow's own hosted
    // payment page and back — without this, that navigation would be
    // blocked the moment someone actually tries to pay inside the
    // Play Store app. Verify the exact hostname Paynow's live checkout
    // actually uses and adjust if it differs.
    // conz.co.zw (bare) is also listed here as a safety net, in case any
    // in-app link or redirect ever points at the bare domain again.
    allowNavigation: ['www.paynow.co.zw', 'paynow.co.zw', 'conz.co.zw'],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
