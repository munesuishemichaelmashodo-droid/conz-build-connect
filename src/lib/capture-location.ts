/**
 * Location capture for delivery evidence.
 *
 * Save to: src/lib/capture-location.ts
 *
 * Design notes:
 *  - Never throws. A driver who declines the permission prompt
 *    must still be able to complete the job; we record the
 *    ABSENCE of location honestly rather than blocking work.
 *  - Records accuracy. A "confirmed at site" claim backed by a
 *    2 km accuracy radius is much weaker than one at 10 m, and
 *    that should be visible rather than implied.
 *  - Call warmLocation() when the confirm screen OPENS, not when
 *    the driver taps upload. A high-accuracy fix can take
 *    5–20 seconds on a phone.
 */

export type LocationStatus =
  | "captured"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unknown";

export interface CapturedLocation {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  status: LocationStatus;
  captured_at: string | null;
}

const EMPTY: CapturedLocation = {
  lat: null,
  lng: null,
  accuracy_m: null,
  status: "unknown",
  captured_at: null,
};

/** Resolves rather than rejects — the caller always gets a usable value. */
export function captureLocation(
  timeoutMs = 15000
): Promise<CapturedLocation> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ...EMPTY, status: "unavailable" });
      return;
    }

    let settled = false;
    const done = (v: CapturedLocation) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    // Belt and braces: some Android browsers never fire the
    // error callback when location services are switched off.
    const timer = setTimeout(
      () => done({ ...EMPTY, status: "timeout" }),
      timeoutMs + 1000
    );

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy ?? null,
          status: "captured",
          captured_at: new Date(pos.timestamp).toISOString(),
        });
      },
      (err) => {
        clearTimeout(timer);
        const status: LocationStatus =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
            ? "timeout"
            : "unavailable";
        done({ ...EMPTY, status });
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 30000, // a fix from the last 30s is fine
      }
    );
  });
}

/**
 * Start acquiring a fix early and cache the promise, so the
 * upload doesn't wait on the GPS.
 *
 *   useEffect(() => { warmLocation(); }, []);
 *   ...
 *   const loc = await getWarmLocation();
 */
let warmPromise: Promise<CapturedLocation> | null = null;
let warmedAt = 0;

export function warmLocation(): void {
  warmPromise = captureLocation();
  warmedAt = Date.now();
}

export async function getWarmLocation(): Promise<CapturedLocation> {
  // a fix older than two minutes isn't evidence of where you are now
  if (!warmPromise || Date.now() - warmedAt > 120000) {
    warmLocation();
  }
  return warmPromise!;
}

/** Human-readable accuracy for the UI. */
export function describeAccuracy(loc: CapturedLocation): string {
  if (loc.status === "denied") return "Location permission denied";
  if (loc.status === "timeout") return "Location took too long";
  if (loc.status === "unavailable") return "Location unavailable";
  if (loc.accuracy_m == null) return "Location captured";
  if (loc.accuracy_m <= 20) return `Location captured (±${Math.round(loc.accuracy_m)} m)`;
  if (loc.accuracy_m <= 100) return `Approximate location (±${Math.round(loc.accuracy_m)} m)`;
  return `Rough location only (±${Math.round(loc.accuracy_m / 1000)} km)`;
}
