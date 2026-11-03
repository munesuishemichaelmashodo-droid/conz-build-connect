import { getRequest } from "@tanstack/react-start/server";
import {
  clientKey,
  createRateLimiter,
  inServiceArea,
  OUTSIDE_SERVICE_AREA_MESSAGE,
  TOO_MANY_REQUESTS_MESSAGE,
} from "@/lib/public-guard";

// Generous on purpose: mobile networks put many phones behind one shared address (carrier
// NAT), so the limit is per address, not per person. A driver's live screen asks at most a
// few routes a minute; these numbers only stop a script looping requests through us.
const routeLimiter = createRateLimiter(240, 60_000);
const geocodeLimiter = createRateLimiter(120, 60_000);

function key(): string {
  try {
    return clientKey(getRequest()?.headers);
  } catch {
    return "unknown";
  }
}

export function guardRouteRequest(points: Array<{ lat: number; lng: number }>): void {
  if (!points.every((p) => inServiceArea(p.lat, p.lng))) {
    throw new Error(OUTSIDE_SERVICE_AREA_MESSAGE);
  }
  if (!routeLimiter(key())) throw new Error(TOO_MANY_REQUESTS_MESSAGE);
}

export function guardGeocodeRequest(point?: { lat: number; lng: number }): void {
  if (point && !inServiceArea(point.lat, point.lng)) throw new Error(OUTSIDE_SERVICE_AREA_MESSAGE);
  if (!geocodeLimiter(key())) throw new Error(TOO_MANY_REQUESTS_MESSAGE);
}
