// Driver live-location sharing: what the driver should see, and what the app should do about it.
// A browser location watch ends silently when the page is left, reloaded, put in the background or when
// the phone suspends the app, so "sharing" must be re-checked, not assumed.

export type ShareHealth = "off" | "starting" | "live" | "stalled" | "blocked";

/** No successful update for this long while sharing = the customer's map is going stale. */
export const STALL_AFTER_MS = 90_000;

export function shareHealth(i: {
  /** Driver started sharing for this job and has not stopped it. */
  intended: boolean;
  /** A location watch is currently running. */
  watching: boolean;
  /** Browser/phone refused location access. */
  denied: boolean;
  lastPushAt: number | null;
  /** When the current watch began; a watch that never produces a first fix is also stalled. */
  watchStartedAt?: number | null;
  now: number;
}): ShareHealth {
  if (i.denied) return "blocked";
  if (!i.intended && !i.watching) return "off";
  if (!i.watching) return "stalled";
  if (i.lastPushAt == null)
    return i.watchStartedAt != null && i.now - i.watchStartedAt > STALL_AFTER_MS
      ? "stalled"
      : "starting";
  return i.now - i.lastPushAt > STALL_AFTER_MS ? "stalled" : "live";
}

const key = (jobId: string) => `conz.share.${jobId}`;

export function readShareIntent(jobId: string, storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(key(jobId)) === "1";
  } catch {
    return false;
  }
}

export function writeShareIntent(
  jobId: string,
  on: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
) {
  try {
    if (on) storage?.setItem(key(jobId), "1");
    else storage?.removeItem(key(jobId));
  } catch {
    /* storage unavailable: sharing still works for this visit */
  }
}

/**
 * A refusal: GeolocationPositionError.code 1, or the wrapped Error from lib/geolocate whose message says the
 * permission is denied or blocked. Timeouts and "position unavailable" are temporary and are retried instead.
 */
export function isPermissionDenied(
  err: { code?: number; message?: string } | null | undefined,
): boolean {
  if (!err) return false;
  if (err.code === 1) return true;
  return /permission (is )?(denied|blocked)/i.test(err.message ?? "");
}

export type ShareNotice = { tone: "ok" | "warn" | "danger"; title: string; detail: string };

export function shareNotice(h: ShareHealth, privacyOn: boolean): ShareNotice {
  if (!privacyOn)
    return {
      tone: "danger",
      title: "Location sharing is turned off",
      detail:
        "Your customer cannot see where you are. Turn it back on in privacy settings to share your live location while you deliver.",
    };
  switch (h) {
    case "live":
      return { tone: "ok", title: "Live location is on", detail: "Your customer can follow you." };
    case "starting":
      return { tone: "ok", title: "Starting live location…", detail: "Getting your position." };
    case "stalled":
      return {
        tone: "warn",
        title: "Your location has stopped updating",
        detail:
          "Your customer cannot see where you are. Keep Con Z open on this screen. We are trying to reconnect; tap Start sharing if it does not come back.",
      };
    case "blocked":
      return {
        tone: "danger",
        title: "Location is blocked on this phone",
        detail:
          "Allow location for Con Z in your phone or browser settings (Location: Allow), then tap Start sharing. Until then your customer cannot see you.",
      };
    default:
      return {
        tone: "warn",
        title: "Your customer cannot see you yet",
        detail:
          "Your customer cannot see where you are. Tap Start sharing so they can follow your delivery live.",
      };
  }
}
