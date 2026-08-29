// Client-context detection for the web/app routing layer.
//
// Con Z's Android "app" is a Capacitor shell in remote-URL mode (see
// capacitor.config.ts) — it loads this same web app from
// https://www.conz.co.zw. There is no separate native codebase, so the
// only real distinction that exists is: is this browser tab rendering
// inside that wrapped shell (native app), or is it a normal browser
// (desktop or mobile web)?
//
// This is a UX/routing layer only. It must never be used to gate access
// to functionality — every route below still works identically from any
// client, and all real authorization stays server-side (RLS/RPCs). This
// file only decides when to *suggest* the app.

import { Capacitor } from "@capacitor/core";

/**
 * True when this code is running inside the wrapped Android app shell.
 * Re-exported from capacitor-oauth-bridge's helper of the same behavior
 * so there's one canonical way to ask this question app-wide.
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * True for a normal mobile browser tab (not the wrapped app). This is
 * the audience for "open in the app" nudges — desktop browser visitors
 * are never shown app prompts, and native-app visitors already are the
 * app so they're excluded too.
 */
export function isMobileWebBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isNativeApp()) return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Set this once the Play Store listing is live. Kept as a single
// constant (rather than scattered literals) so publishing the app is a
// one-line change here, not a hunt through every route that shows a
// banner. While null, app-nudge UI stays silent instead of linking
// anywhere — never show a button with nowhere real to go.
export const PLAY_STORE_URL: string | null = null;

// Android App Links use this to open the installed app directly instead
// of a browser tab, when the app is installed and published. Declared
// here so it stays in sync with capacitor.config.ts's appId and the
// intent-filter host in AndroidManifest.xml.
export const ANDROID_APP_ID = "com.conz.app";
