// When a PAGE itself cannot load (no signal, app reopened in a dead zone), the service worker answers with /offline.html,
// a small self-contained page that shows the delivery details saved on this phone (see lib/offline-card.ts) instead of the
// browser's error page. public/sw.js applies the same rule as shouldServeOfflinePage below.

export const OFFLINE_PAGE_URL = "/offline.html";

/** Only a page the person is opening, by a plain GET. Data requests, scripts and posts are never touched. */
export function shouldServeOfflinePage(req: { mode: string; method: string }): boolean {
  return req.mode === "navigate" && req.method === "GET";
}

/** Registers the worker (it also handles push) so the fallback page is ready before the next dead zone. Never throws. */
export async function registerOfflineFallback(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    /* no worker support (or blocked): everything else still works while there is signal */
  }
}
