import { describe, expect, it } from "vitest";
import {
  REACH_FRESH_MINUTES,
  driverReach,
  availabilityValues,
  saveAvailability,
  type AvailabilityRow,
} from "@/lib/driver-reach";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const row = (over: Partial<AvailabilityRow> = {}): AvailabilityRow => ({
  is_available: true,
  lat: -17.8,
  lng: 31.05,
  updated_at: minutesAgo(1),
  ...over,
});

describe("driverReach", () => {
  it("matches the 15-minute freshness rule used by dispatch (migration 0089)", () => {
    expect(REACH_FRESH_MINUTES).toBe(15);
  });

  it("is offline when there is no saved row", () => {
    expect(driverReach(null, NOW).kind).toBe("offline");
  });

  it("is offline when the saved row says not available", () => {
    expect(driverReach(row({ is_available: false }), NOW).kind).toBe("offline");
  });

  it("needs a location when online without coordinates", () => {
    expect(driverReach(row({ lat: null, lng: null }), NOW).kind).toBe("no_location");
  });

  it("is reachable when online with a position under 15 minutes old", () => {
    expect(driverReach(row({ updated_at: minutesAgo(14) }), NOW).kind).toBe("reachable");
  });

  it("is stale once the position is 15 minutes old or more", () => {
    expect(driverReach(row({ updated_at: minutesAgo(15) }), NOW).kind).toBe("stale");
  });

  it("treats a missing or unreadable time as stale, never reachable", () => {
    expect(driverReach(row({ updated_at: null }), NOW).kind).toBe("stale");
    expect(driverReach(row({ updated_at: "not a date" }), NOW).kind).toBe("stale");
  });

  it("gives every state a title and a next step", () => {
    for (const r of [
      null,
      row({ is_available: false }),
      row({ lat: null, lng: null }),
      row(),
      row({ updated_at: minutesAgo(30) }),
    ]) {
      const reach = driverReach(r, NOW);
      expect(reach.title.length).toBeGreaterThan(0);
      expect(reach.detail.length).toBeGreaterThan(0);
    }
  });
});

// A stand-in for the Supabase client: only the call chain saveAvailability uses,
// returning what PostgREST would return.
function fakeClient(result: { error: { message: string; code?: string } | null }) {
  const calls: unknown[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(values: unknown) {
          calls.push({ table, values });
          return Promise.resolve(result);
        },
      };
    },
  };
  return { client, calls };
}

describe("saveAvailability", () => {
  const values = {
    driver_id: "d1",
    is_available: true,
    lat: -17.8,
    lng: 31.05,
    updated_at: minutesAgo(0),
  };

  it("writes the driver's own row to driver_availability", async () => {
    const { client, calls } = fakeClient({ error: null });
    const res = await saveAvailability(client, values);
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual([{ table: "driver_availability", values }]);
  });

  it("reports a failed save instead of hiding it", async () => {
    const { client } = fakeClient({
      error: { message: "new row violates row-level security policy", code: "42501" },
    });
    const res = await saveAvailability(client, values);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/couldn't|could not/i);
  });

  it("explains the speed check when a position jump is rejected", async () => {
    const { client } = fakeClient({
      error: {
        message: "Location update implies an implausible speed (~950 km/h) -- rejected.",
        code: "P0001",
      },
    });
    const res = await saveAvailability(client, values);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/location/i);
  });

  it("reports a network failure as a failed save", async () => {
    const client = {
      from: () => ({ upsert: () => Promise.reject(new TypeError("Failed to fetch")) }),
    };
    const res = await saveAvailability(client, values);
    expect(res.ok).toBe(false);
  });
});

describe("availabilityValues", () => {
  const at = "2026-10-23T12:00:00.000Z";

  it("saves the position with the time when the phone gives one", () => {
    expect(availabilityValues("d1", true, { lat: -17.8, lng: 31.05 }, at)).toEqual({
      driver_id: "d1",
      is_available: true,
      lat: -17.8,
      lng: 31.05,
      updated_at: at,
    });
  });

  it("clears the old position when going online without one, so an old fix is never stamped as fresh", () => {
    expect(availabilityValues("d1", true, null, at)).toEqual({
      driver_id: "d1",
      is_available: true,
      lat: null,
      lng: null,
      updated_at: at,
    });
  });

  it("leaves the last position alone when going offline", () => {
    expect(availabilityValues("d1", false, null, at)).toEqual({
      driver_id: "d1",
      is_available: false,
      updated_at: at,
    });
  });
});
