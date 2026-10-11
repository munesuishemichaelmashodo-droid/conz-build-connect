import { describe, expect, it } from "vitest";

import {
  DRIVER_FIX_MAX_AGE_MS,
  FAR_JOB_KM,
  distanceLabel,
  haversineKm,
  jobDistance,
} from "@/lib/jobDistance";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const fresh = (lat: number, lng: number) => ({
  lat,
  lng,
  updatedAt: new Date(NOW - 2 * 60 * 1000).toISOString(),
});
const HARARE = { pickup_lat: -17.83, pickup_lng: 31.05 };
const BULAWAYO = { pickup_lat: -20.15, pickup_lng: 28.58 };

describe("haversineKm", () => {
  it("is null unless both points have finite coordinates", () => {
    expect(haversineKm({ lat: 1, lng: null }, { lat: 1, lng: 1 })).toBeNull();
    expect(haversineKm({ lat: undefined, lng: 1 }, { lat: 1, lng: 1 })).toBeNull();
    expect(haversineKm({ lat: Number.NaN, lng: 1 }, { lat: 1, lng: 1 })).toBeNull();
  });
  it("matches a known great-circle distance (Harare - Bulawayo is roughly 366 km as the crow flies)", () => {
    const km = haversineKm({ lat: -17.83, lng: 31.05 }, { lat: -20.15, lng: 28.58 })!;
    expect(km).toBeGreaterThan(355);
    expect(km).toBeLessThan(380);
  });
});

describe("jobDistance: available coordinates", () => {
  it("shows a straight-line distance when both positions are known and fresh", () => {
    const d = jobDistance(fresh(-17.85, 31.03), HARARE, { now: NOW });
    expect(d).toMatchObject({ status: "ok", basis: "straight_line", far: false });
    if (d.status === "ok") expect(d.km).toBeLessThan(5);
  });

  it("flags a distant job as far but still returns its distance (nothing is hidden)", () => {
    const d = jobDistance(fresh(-17.85, 31.03), BULAWAYO, { now: NOW });
    expect(d).toMatchObject({ status: "ok", far: true });
    if (d.status === "ok") expect(d.km).toBeGreaterThan(FAR_JOB_KM);
  });

  it("uses a strict threshold: exactly the far limit is not far, just beyond it is", () => {
    const driver = fresh(-17.85, 31.03);
    const km = haversineKm({ lat: driver.lat, lng: driver.lng }, { lat: -20.15, lng: 28.58 })!;
    expect(jobDistance(driver, BULAWAYO, { now: NOW, farKm: km })).toMatchObject({ far: false });
    expect(jobDistance(driver, BULAWAYO, { now: NOW, farKm: km - 0.001 })).toMatchObject({
      far: true,
    });
  });
});

describe("jobDistance: missing or stale driver location", () => {
  it("has no driver location -> says so, no number", () => {
    expect(jobDistance(null, HARARE, { now: NOW })).toEqual({ status: "no_driver_location" });
    expect(
      jobDistance({ lat: null, lng: null, updatedAt: new Date(NOW).toISOString() }, HARARE, {
        now: NOW,
      }),
    ).toEqual({ status: "no_driver_location" });
    expect(jobDistance({ lat: -17.8, lng: 31, updatedAt: null }, HARARE, { now: NOW })).toEqual({
      status: "no_driver_location",
    });
  });

  it("a position older than the dispatch freshness window is stale, not shown as a distance", () => {
    const old = {
      lat: -17.85,
      lng: 31.03,
      updatedAt: new Date(NOW - DRIVER_FIX_MAX_AGE_MS - 1000).toISOString(),
    };
    expect(jobDistance(old, HARARE, { now: NOW })).toEqual({ status: "stale_driver_location" });
  });

  it("a position exactly at the window edge is still fresh", () => {
    const edge = {
      lat: -17.85,
      lng: 31.03,
      updatedAt: new Date(NOW - DRIVER_FIX_MAX_AGE_MS).toISOString(),
    };
    expect(jobDistance(edge, HARARE, { now: NOW }).status).toBe("ok");
  });

  it("an unparseable timestamp is treated as stale, never as fresh", () => {
    expect(
      jobDistance({ lat: -17.85, lng: 31.03, updatedAt: "not-a-date" }, HARARE, { now: NOW }),
    ).toEqual({ status: "stale_driver_location" });
  });
});

describe("jobDistance: missing pickup coordinates", () => {
  it("shows no distance and no label (no default depot, no delivery-pin substitute)", () => {
    const d = jobDistance(
      fresh(-17.85, 31.03),
      { pickup_lat: null, pickup_lng: null },
      { now: NOW },
    );
    expect(d).toEqual({ status: "no_pickup" });
    expect(distanceLabel(d)).toBeNull();
    expect(jobDistance(fresh(-17.85, 31.03), {}, { now: NOW })).toEqual({ status: "no_pickup" });
  });
});

describe("road distance versus straight-line distance", () => {
  const driver = fresh(-17.85, 31.03);

  it("labels a figure 'by road' only when a road router (osrm) produced it", () => {
    const d = jobDistance(driver, HARARE, { now: NOW, road: { km: 18.4, source: "osrm" } });
    expect(d).toMatchObject({ status: "ok", basis: "road", km: 18.4 });
    expect(distanceLabel(d)).toBe("18 km from you by road");
  });

  it("a router fallback that is really a straight line is never called road distance", () => {
    const d = jobDistance(driver, HARARE, { now: NOW, road: { km: 12, source: "haversine" } });
    expect(d).toMatchObject({ status: "ok", basis: "straight_line" });
    expect(distanceLabel(d)).toMatch(/straight line, not road/);
    expect(distanceLabel(d)).not.toMatch(/by road/);
  });

  it("ignores an invalid road figure and falls back to the labelled straight line", () => {
    for (const km of [Number.NaN, -3]) {
      const d = jobDistance(driver, HARARE, { now: NOW, road: { km, source: "osrm" } });
      expect(d).toMatchObject({ status: "ok", basis: "straight_line" });
    }
  });

  it("the far flag follows the road figure when one exists", () => {
    const d = jobDistance(driver, HARARE, { now: NOW, road: { km: 250, source: "osrm" } });
    expect(d).toMatchObject({ basis: "road", far: true });
  });

  it("a straight-line label never claims road", () => {
    const d = jobDistance(driver, HARARE, { now: NOW });
    expect(distanceLabel(d)).toMatch(/^About \d+ km from you \(straight line, not road\)$/);
  });
});

describe("nationwide visibility is never reduced by distance", () => {
  it("every status (near, far, unknown) is display-only: a job list mapped through it keeps every job", () => {
    const jobs = [
      { id: "near", ...HARARE },
      { id: "far", ...BULAWAYO },
      { id: "nopickup", pickup_lat: null, pickup_lng: null },
    ];
    const driver = fresh(-17.85, 31.03);
    const shown = jobs.map((j) => ({ id: j.id, d: jobDistance(driver, j, { now: NOW }) }));
    expect(shown.map((s) => s.id)).toEqual(["near", "far", "nopickup"]);
    expect(shown[1].d).toMatchObject({ status: "ok", far: true });
  });

  it("messages for missing/stale locations tell the driver what to do", () => {
    expect(distanceLabel({ status: "no_driver_location" })).toMatch(/go online/i);
    expect(distanceLabel({ status: "stale_driver_location" })).toMatch(/out of date/i);
  });
});
