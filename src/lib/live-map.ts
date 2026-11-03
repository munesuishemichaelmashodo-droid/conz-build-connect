/**
 * Helpers for the customer-facing live delivery map (shared tracking link).
 * Pure functions so they can be unit tested without a map.
 */

export type LatLng = { lat: number; lng: number };

/** Straight-line distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * The free route service times a car. A loaded tipper is slower (weight, hills, gear changes,
 * site entrances), so the customer sees the car time stretched by this factor. It is an
 * estimate: tune it once real trip times (job_route_points) are compared with the estimates.
 */
export const TRUCK_TIME_FACTOR = 1.4;

/** Truck driving time in minutes from the route service's car time. */
export function truckEtaMin(carMin: number | null | undefined): number | null {
  if (carMin == null || !Number.isFinite(carMin) || carMin < 0) return null;
  return Math.max(1, Math.ceil(carMin * TRUCK_TIME_FACTOR));
}

/** Within this distance of the delivery point the truck counts as "at the site". */
export const AT_SITE_M = 150;

/**
 * Ask for a new road route only when the truck has moved a meaningful distance or the last
 * route is old. Keeps the free route server (and the customer's data bundle) from being hit on
 * every 15-second refresh.
 */
export const ROUTE_REFRESH_MOVE_M = 250;
export const ROUTE_REFRESH_MAX_AGE_MS = 3 * 60_000;

export function shouldRefreshRoute(
  last: { from: LatLng; at: number } | null,
  current: LatLng,
  now: number,
): boolean {
  if (!last) return true;
  if (now - last.at >= ROUTE_REFRESH_MAX_AGE_MS) return true;
  return distanceM(last.from, current) >= ROUTE_REFRESH_MOVE_M;
}

/** Short line for the chip on top of the map. */
export function etaChipText(etaMin: number | null, distanceKm: number | null): string | null {
  if (etaMin == null) return null;
  const time = etaMin < 60 ? `${etaMin} min` : `${Math.floor(etaMin / 60)} h ${etaMin % 60} min`;
  const dist =
    distanceKm == null
      ? ""
      : distanceKm < 1
        ? ` · ${Math.round(distanceKm * 1000)} m`
        : ` · ${distanceKm.toFixed(1)} km`;
  return `About ${time} away${dist}`;
}
