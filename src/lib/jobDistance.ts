/**
 * Driver-to-pickup distance for the open-jobs feed (display only).
 *
 * Owner decision 11/10/2026: show drivers how far a job is and flag distant
 * jobs, but never hide it -- nationwide participation stays open. Eligibility
 * (verification, wallet, truck, instant-dispatch radius) is enforced by the
 * database and is not touched here.
 *
 * Honesty rules:
 *   * A distance is only shown when BOTH points have coordinates.
 *   * The driver's position must be fresh (same 15-minute window the dispatch
 *     engine uses). Otherwise we say so instead of showing a stale number.
 *   * Great-circle distance is labelled "straight line". A figure is labelled
 *     "by road" only when a road router (OSRM) actually produced it.
 */

export const FAR_JOB_KM = 100; // matches the final instant-dispatch radius stage
export const DRIVER_FIX_MAX_AGE_MS = 15 * 60 * 1000;

export type Point = { lat: number | null | undefined; lng: number | null | undefined };
export type DriverFix = { lat: number | null; lng: number | null; updatedAt: string | null } | null;
export type RoadDistance = { km: number; source: "osrm" | "haversine" } | null | undefined;

export type JobDistance =
  | { status: "ok"; km: number; basis: "road" | "straight_line"; far: boolean }
  | { status: "no_driver_location" }
  | { status: "stale_driver_location" }
  | { status: "no_pickup" };

/** Great-circle distance in km, or null when either point lacks coordinates. */
export function haversineKm(a: Point, b: Point): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function jobDistance(
  driver: DriverFix,
  job: { pickup_lat?: number | null; pickup_lng?: number | null },
  opts: { now?: number; road?: RoadDistance; farKm?: number } = {},
): JobDistance {
  const now = opts.now ?? Date.now();
  const farKm = opts.farKm ?? FAR_JOB_KM;

  if (job.pickup_lat == null || job.pickup_lng == null) return { status: "no_pickup" };
  if (!driver || driver.lat == null || driver.lng == null || !driver.updatedAt) {
    return { status: "no_driver_location" };
  }
  const age = now - new Date(driver.updatedAt).getTime();
  if (!Number.isFinite(age) || age > DRIVER_FIX_MAX_AGE_MS)
    return { status: "stale_driver_location" };

  // Only a genuine road-router result counts as road distance.
  const road = opts.road;
  if (road && road.source === "osrm" && Number.isFinite(road.km) && road.km >= 0) {
    return { status: "ok", km: road.km, basis: "road", far: road.km > farKm };
  }
  const km = haversineKm(
    { lat: driver.lat, lng: driver.lng },
    { lat: job.pickup_lat, lng: job.pickup_lng },
  );
  if (km == null) return { status: "no_driver_location" };
  return { status: "ok", km, basis: "straight_line", far: km > farKm };
}

/** One short line for the feed card, or null when there is nothing honest to say. */
export function distanceLabel(d: JobDistance): string | null {
  switch (d.status) {
    case "ok": {
      const km = Math.round(d.km);
      return d.basis === "road"
        ? `${km} km from you by road`
        : `About ${km} km from you (straight line, not road)`;
    }
    case "no_driver_location":
      return "Go online to see how far this pickup is from you";
    case "stale_driver_location":
      return "Your location is out of date — go online to refresh the distance";
    case "no_pickup":
      return null;
  }
}
