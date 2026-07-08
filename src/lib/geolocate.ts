// Robust geolocation helper.
// Strategy:
//   1) Kick off a fast low-accuracy fix (works indoors, on Wi-Fi/IP).
//   2) Simultaneously request a high-accuracy fix.
//   3) Return whichever arrives first; if high-accuracy comes back later
//      with better accuracy, resolve callers via onUpdate.
// Also verifies the Permissions API and surfaces clear errors.

export type Coords = { lat: number; lng: number; accuracy?: number };

export type GeolocateOptions = {
  /** Called when a better fix arrives after the initial resolve. */
  onUpdate?: (c: Coords) => void;
  /** Hard timeout for the whole operation. */
  timeoutMs?: number;
};

export async function locateOnce({ onUpdate, timeoutMs = 20000 }: GeolocateOptions = {}): Promise<Coords> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    throw new Error("Geolocation is not supported on this device");
  }

  // Permissions API is optional; if denied surface a clear message.
  try {
    const perm = await (navigator as any).permissions?.query?.({ name: "geolocation" });
    if (perm?.state === "denied") {
      throw new Error("Location permission is blocked. Enable it in your browser settings.");
    }
  } catch {
    // ignore — Safari on iOS may throw here
  }

  return new Promise<Coords>((resolve, reject) => {
    let resolved = false;
    let bestAcc = Infinity;

    const finish = (c: Coords) => {
      if (resolved) {
        if ((c.accuracy ?? Infinity) < bestAcc) {
          bestAcc = c.accuracy ?? Infinity;
          onUpdate?.(c);
        }
        return;
      }
      resolved = true;
      bestAcc = c.accuracy ?? Infinity;
      resolve(c);
    };

    const fail = (e: GeolocationPositionError | Error) => {
      if (resolved) return;
      resolved = true;
      const msg =
        "code" in e
          ? e.code === 1
            ? "Location permission denied. Enable it in your browser settings."
            : e.code === 2
            ? "Your device could not determine your location. Try moving near a window or outside."
            : "Getting your location took too long. Check your GPS / internet and try again."
          : e.message || "Could not get location";
      reject(new Error(msg));
    };

    // 1) Fast, low-accuracy attempt
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {
        /* let hi-acc attempt handle failure */
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 },
    );

    // 2) High-accuracy attempt in parallel
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => fail(err),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );

    // Overall guard
    setTimeout(() => {
      if (!resolved) fail(new Error("Getting your location took too long. Move outside or check GPS and try again."));
    }, timeoutMs + 500);
  });
}
