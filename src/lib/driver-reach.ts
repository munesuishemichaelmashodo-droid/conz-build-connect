// Whether a driver can be sent automatic job offers, from their own
// driver_availability row. Mirrors the rule in eligible_dispatch_drivers
// (migration 0089): available, with a position, updated in the last 15 minutes.
// The other dispatch rules (verified, truck, wallet, not on a job) are checked
// on the server and are not repeated here.

export const REACH_FRESH_MINUTES = 15;

export type AvailabilityRow = {
  is_available: boolean | null;
  lat: number | null;
  lng: number | null;
  updated_at: string | null;
};

export type Reach = {
  kind: "offline" | "no_location" | "stale" | "reachable";
  title: string;
  detail: string;
};

export function driverReach(row: AvailabilityRow | null, now: number): Reach {
  if (!row || !row.is_available) {
    return {
      kind: "offline",
      title: "You're offline",
      detail: "Go online to get job offers near you.",
    };
  }
  if (row.lat == null || row.lng == null) {
    return {
      kind: "no_location",
      title: "Online, but no location",
      detail: "Allow location for Con Z so nearby jobs can reach you.",
    };
  }
  const at = row.updated_at ? Date.parse(row.updated_at) : NaN;
  if (!Number.isFinite(at) || now - at >= REACH_FRESH_MINUTES * 60_000) {
    return {
      kind: "stale",
      title: "Online, but your location is old",
      detail: "Open Con Z to refresh it. Offers only go to drivers seen in the last 15 minutes.",
    };
  }
  return {
    kind: "reachable",
    title: "Getting offers near you",
    detail: "Keep Con Z open while you wait for loads.",
  };
}

type UpsertClient = {
  from: (table: "driver_availability") => {
    upsert: (
      values: AvailabilitySave,
    ) => PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
};

export type AvailabilitySave = {
  driver_id: string;
  is_available: boolean;
  lat?: number | null;
  lng?: number | null;
  updated_at: string;
};

/**
 * The row to save. Going online without a position clears the old one: the
 * save stamps the time, and dispatch would otherwise read a stale position as
 * fresh. Going offline leaves the last position alone.
 */
export function availabilityValues(
  driverId: string,
  available: boolean,
  position: { lat: number; lng: number } | null,
  at: string,
): AvailabilitySave {
  const base = { driver_id: driverId, is_available: available };
  if (position) return { ...base, lat: position.lat, lng: position.lng, updated_at: at };
  if (available) return { ...base, lat: null, lng: null, updated_at: at };
  return { ...base, updated_at: at };
}

export type SaveResult = { ok: true } | { ok: false; message: string };

/** Saves the driver's own row and says plainly when it did not work. */
export async function saveAvailability(
  client: UpsertClient,
  values: AvailabilitySave,
): Promise<SaveResult> {
  try {
    const { error } = await client.from("driver_availability").upsert(values);
    if (!error) return { ok: true };
    if (/implausible speed/i.test(error.message)) {
      return {
        ok: false,
        message:
          "Your location jumped too far to be real, so it wasn't saved. Try again in a minute.",
      };
    }
    return {
      ok: false,
      message: "Couldn't save your status. Check your connection and try again.",
    };
  } catch {
    return {
      ok: false,
      message: "Couldn't save your status. Check your connection and try again.",
    };
  }
}
