// Pickup location checks and route trails (migration 0112), as shown to admins, and
// the driver's "Where did you load?" answer for driver-arranged pickups. The database
// decides the status; these helpers only word it and keep the driver moving.

export type PickupCheckStatus = "ok" | "far" | "no_location" | "no_expected_point";

export type PickupCheck = {
  status: PickupCheckStatus | null;
  distance_m: number | null;
  loaded_at_name: string | null;
  expected_source: "supply_location" | "job_pickup_point" | null;
  checked_at: string | null;
};

export type RoutePoint = { lat: number; lng: number; recorded_at: string };

/** A job with no supplier point: the driver chose where to load. */
export function isDriverArrangedPickup(job: {
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  supply_location_id?: string | null;
}): boolean {
  return job.pickup_lat == null && job.pickup_lng == null && !job.supply_location_id;
}

/** Same rule the database uses to alert admins. */
export function needsPickupAttention(check: PickupCheck): boolean {
  if (check.status === "far" || check.status === "no_location") return true;
  return check.status === "no_expected_point" && !check.loaded_at_name;
}

const distanceText = (m: number) =>
  m >= 1000 ? `${(Math.round(m / 100) / 10).toFixed(1)} km` : `${Math.round(m)} m`;

export function pickupCheckSummary(check: PickupCheck): { tone: "ok" | "warn"; text: string } {
  const named = check.loaded_at_name ? ` Driver says they loaded at: ${check.loaded_at_name}.` : "";
  switch (check.status) {
    case "ok":
      return {
        tone: "ok",
        text: `Loaded ${distanceText(check.distance_m ?? 0)} from the expected supplier.`,
      };
    case "far":
      return {
        tone: "warn",
        text: `Loaded ${distanceText(check.distance_m ?? 0)} from the expected supplier (more than 2 km).`,
      };
    case "no_location":
      return {
        tone: "warn",
        text: `The pickup photo has no location, so where it was loaded is unknown.${named}`,
      };
    case "no_expected_point":
      return check.loaded_at_name
        ? { tone: "ok", text: `Driver-arranged pickup.${named}` }
        : {
            tone: "warn",
            text: "Driver-arranged pickup and the driver did not say where they loaded.",
          };
    default:
      return { tone: "ok", text: `No pickup photo yet.${named}` };
  }
}

const km = (a: RoutePoint, b: RoutePoint) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Points, time span and distance along the recorded trail (straight lines between points). */
export function routeSummary(
  points: RoutePoint[],
): { count: number; startedAt: string; endedAt: string; km: number } | null {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  let total = 0;
  for (let i = 1; i < sorted.length; i++) total += km(sorted[i - 1], sorted[i]);
  return {
    count: sorted.length,
    startedAt: sorted[0].recorded_at,
    endedAt: sorted[sorted.length - 1].recorded_at,
    km: Math.round(total * 10) / 10,
  };
}

type RpcClient = {
  rpc: (
    fn: "set_job_loaded_at",
    args: { _job_id: string; _name: string },
  ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
};

/**
 * Saves where the driver loaded. Before 0112 is live the function does not exist;
 * that must never stop a delivery, so it is skipped rather than reported.
 */
export async function saveLoadedAt(
  client: RpcClient,
  jobId: string,
  name: string,
): Promise<{ ok: true; skipped?: boolean } | { ok: false; message: string }> {
  const clean = name.trim();
  if (clean.length < 2) {
    return { ok: false, message: "Say where you loaded: the name of the quarry or supplier." };
  }
  const { error } = await client.rpc("set_job_loaded_at", { _job_id: jobId, _name: clean });
  if (!error) return { ok: true };
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
    return { ok: true, skipped: true };
  }
  return { ok: false, message: error.message };
}
