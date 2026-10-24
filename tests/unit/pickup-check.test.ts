import { describe, expect, it } from "vitest";
import {
  isDriverArrangedPickup,
  needsPickupAttention,
  pickupCheckSummary,
  routeSummary,
  saveLoadedAt,
  type PickupCheck,
} from "@/lib/pickup-check";

const check = (over: Partial<PickupCheck> = {}): PickupCheck => ({
  status: "ok",
  distance_m: 900,
  loaded_at_name: null,
  expected_source: "supply_location",
  checked_at: "2026-10-24T08:00:00Z",
  ...over,
});

describe("isDriverArrangedPickup", () => {
  it("is true when the job has no pickup point and no supply location", () => {
    expect(
      isDriverArrangedPickup({ pickup_lat: null, pickup_lng: null, supply_location_id: null }),
    ).toBe(true);
  });
  it("is false when a supplier was chosen", () => {
    expect(
      isDriverArrangedPickup({ pickup_lat: -17.7, pickup_lng: 31, supply_location_id: "s1" }),
    ).toBe(false);
    expect(
      isDriverArrangedPickup({ pickup_lat: null, pickup_lng: null, supply_location_id: "s1" }),
    ).toBe(false);
    expect(
      isDriverArrangedPickup({ pickup_lat: -17.7, pickup_lng: 31, supply_location_id: null }),
    ).toBe(false);
  });
});

describe("pickupCheckSummary", () => {
  it("states a normal pickup with its distance", () => {
    expect(pickupCheckSummary(check())).toEqual({
      tone: "ok",
      text: "Loaded 900 m from the expected supplier.",
    });
  });
  it("flags a far pickup in km", () => {
    expect(pickupCheckSummary(check({ status: "far", distance_m: 6123 }))).toEqual({
      tone: "warn",
      text: "Loaded 6.1 km from the expected supplier (more than 2 km).",
    });
  });
  it("flags a photo without location", () => {
    expect(pickupCheckSummary(check({ status: "no_location", distance_m: null })).tone).toBe(
      "warn",
    );
  });
  it("names where a driver-arranged load came from", () => {
    expect(
      pickupCheckSummary(
        check({ status: "no_expected_point", distance_m: null, loaded_at_name: "Mazowe pit" }),
      ),
    ).toEqual({
      tone: "ok",
      text: "Driver-arranged pickup. Driver says they loaded at: Mazowe pit.",
    });
  });
  it("flags a driver-arranged load with no named source", () => {
    expect(pickupCheckSummary(check({ status: "no_expected_point", distance_m: null })).tone).toBe(
      "warn",
    );
  });
  it("says so when the pickup photo is not in yet", () => {
    expect(
      pickupCheckSummary(check({ status: null, distance_m: null, loaded_at_name: "Mazowe pit" }))
        .text,
    ).toMatch(/no pickup photo yet/i);
  });
});

describe("needsPickupAttention", () => {
  it("matches the database's alert rule", () => {
    expect(needsPickupAttention(check())).toBe(false);
    expect(needsPickupAttention(check({ status: "far" }))).toBe(true);
    expect(needsPickupAttention(check({ status: "no_location" }))).toBe(true);
    expect(needsPickupAttention(check({ status: "no_expected_point" }))).toBe(true);
    expect(
      needsPickupAttention(check({ status: "no_expected_point", loaded_at_name: "Pit" })),
    ).toBe(false);
    expect(needsPickupAttention(check({ status: null }))).toBe(false);
  });
});

describe("routeSummary", () => {
  it("is empty without points", () => {
    expect(routeSummary([])).toBeNull();
  });
  it("counts points, gives the time span and the distance along the trail", () => {
    const s = routeSummary([
      { lat: -17.7, lng: 31.0, recorded_at: "2026-10-24T08:00:00Z" },
      { lat: -17.71, lng: 31.0, recorded_at: "2026-10-24T08:04:00Z" },
      { lat: -17.72, lng: 31.0, recorded_at: "2026-10-24T08:08:00Z" },
    ]);
    expect(s?.count).toBe(3);
    expect(s?.startedAt).toBe("2026-10-24T08:00:00Z");
    expect(s?.endedAt).toBe("2026-10-24T08:08:00Z");
    expect(s?.km).toBeGreaterThan(2.1);
    expect(s?.km).toBeLessThan(2.4);
  });
});

function fakeRpc(result: { error: { message: string; code?: string } | null }) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: unknown) {
        calls.push({ fn, args });
        return Promise.resolve(result);
      },
    },
  };
}

describe("saveLoadedAt", () => {
  it("sends the trimmed name to set_job_loaded_at", async () => {
    const { client, calls } = fakeRpc({ error: null });
    expect(await saveLoadedAt(client, "j1", "  Mazowe pit  ")).toEqual({ ok: true });
    expect(calls).toEqual([
      { fn: "set_job_loaded_at", args: { _job_id: "j1", _name: "Mazowe pit" } },
    ]);
  });
  it("refuses an empty answer without calling the server", async () => {
    const { client, calls } = fakeRpc({ error: null });
    const res = await saveLoadedAt(client, "j1", " ");
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("never blocks the driver before the database change is live", async () => {
    const { client } = fakeRpc({
      error: { code: "PGRST202", message: "Could not find the function public.set_job_loaded_at" },
    });
    expect(await saveLoadedAt(client, "j1", "Mazowe pit")).toEqual({ ok: true, skipped: true });
  });
  it("reports any other refusal", async () => {
    const { client } = fakeRpc({
      error: {
        code: "42501",
        message: "Only the assigned driver can say where the load came from.",
      },
    });
    const res = await saveLoadedAt(client, "j1", "Mazowe pit");
    expect(res).toEqual({
      ok: false,
      message: "Only the assigned driver can say where the load came from.",
    });
  });
});
