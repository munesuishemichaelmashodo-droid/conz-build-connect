/**
 * Guards for the few server endpoints that work without a login (road route, address search,
 * reverse geocode). They call free outside services (OSRM demo server, Nominatim) that block
 * callers who send too much; if OSRM blocks us, price checks stop (road pricing fails closed).
 * So: only coordinates in and around Zimbabwe, and a per-visitor request limit.
 */

/** Zimbabwe (lat -22.42..-15.61, lng 25.24..33.06) plus a margin for border towns. */
export const SERVICE_AREA = { minLat: -23.1, maxLat: -14.9, minLng: 24.5, maxLng: 33.8 };

export function inServiceArea(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= SERVICE_AREA.minLat &&
    lat <= SERVICE_AREA.maxLat &&
    lng >= SERVICE_AREA.minLng &&
    lng <= SERVICE_AREA.maxLng
  );
}

export const OUTSIDE_SERVICE_AREA_MESSAGE = "That location is outside the area Con Z serves.";
export const TOO_MANY_REQUESTS_MESSAGE = "Too many requests. Wait a minute and try again.";

/**
 * Fixed-window counter per key, kept in this server instance's memory. Not a hard global
 * limit (each serverless instance counts on its own), but it stops one visitor from looping
 * thousands of requests through us.
 */
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string, now: number = Date.now()): boolean => {
    const h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      if (hits.size >= maxKeys) hits.clear();
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    h.count += 1;
    return h.count <= limit;
  };
}

/** The visitor's address as Vercel reports it (first x-forwarded-for entry). */
export function clientKey(headers: Headers | undefined | null): string {
  const fwd = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers?.get("x-real-ip")?.trim() || "unknown";
}
