// Mobile-web-only nudge toward the native app, for routes where the app
// experience is meaningfully better (camera uploads, GPS tracking,
// reliable push). Renders nothing on desktop, nothing inside the native
// app itself, and nothing until PLAY_STORE_URL is actually set — no
// dead-end buttons before the app is published.
//
// Dismissing is per-browser-session only (sessionStorage): the nudge
// comes back on next visit rather than being permanently silenced,
// since the underlying reason to prefer the app hasn't gone away.

import { useEffect, useState } from "react";
import { X, Smartphone } from "lucide-react";
import { isMobileWebBrowser, PLAY_STORE_URL } from "@/lib/platform";

const DISMISS_KEY = "conz_open_in_app_dismissed";

export function OpenInAppBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!PLAY_STORE_URL) return;
    if (!isMobileWebBrowser()) return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    setVisible(true);
  }, []);

  if (!visible || !PLAY_STORE_URL) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
      <Smartphone className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1 text-white/90">
        Get a smoother experience — open this in the Con Z app.
      </span>
      <a
        href={PLAY_STORE_URL}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Open app
      </a>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, "1");
          setVisible(false);
        }}
        className="shrink-0 text-white/50 hover:text-white/80"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
