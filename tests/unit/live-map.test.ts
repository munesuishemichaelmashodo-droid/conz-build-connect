import { describe, expect, it } from "vitest";
import {
  AT_SITE_M,
  distanceM,
  etaChipText,
  shouldRefreshRoute,
  truckEtaMin,
  withTruckEta,
} from "@/lib/live-map";

const A = { lat: -17.7905, lng: 31.0472 };

describe("live delivery map helpers", () => {
  it("measures distance in metres", () => {
    expect(distanceM(A, A)).toBe(0);
    // ~0.001 deg latitude is ~111 m
    expect(Math.round(distanceM(A, { lat: A.lat + 0.001, lng: A.lng }))).toBeGreaterThan(105);
    expect(AT_SITE_M).toBe(150);
  });

  it("stretches the car time for a loaded truck and never shows 0", () => {
    expect(truckEtaMin(10)).toBe(14);
    expect(truckEtaMin(0)).toBe(1);
    expect(truckEtaMin(null)).toBeNull();
    expect(truckEtaMin(Number.NaN)).toBeNull();
  });

  it("asks for a new route only after real movement or 3 minutes", () => {
    const t = 1_000_000;
    expect(shouldRefreshRoute(null, A, t)).toBe(true);
    const last = { from: A, at: t };
    expect(shouldRefreshRoute(last, { lat: A.lat + 0.0005, lng: A.lng }, t + 15_000)).toBe(false);
    expect(shouldRefreshRoute(last, { lat: A.lat + 0.003, lng: A.lng }, t + 15_000)).toBe(true);
    expect(shouldRefreshRoute(last, A, t + 3 * 60_000)).toBe(true);
  });

  it("writes the chip text", () => {
    expect(etaChipText(14, 8.24)).toBe("About 14 min away · 8.2 km");
    expect(etaChipText(75, 0.4)).toBe("About 1 h 15 min away · 400 m");
    expect(etaChipText(null, 3)).toBeNull();
  });
});

describe("withTruckEta", () => {
  it("shows truck time, matching the shared tracking link", () => {
    expect(withTruckEta({ etaMin: 10, distanceKm: 8, source: "osrm" }).etaMin).toBe(
      truckEtaMin(10),
    );
  });
  it("leaves distance and other fields alone", () => {
    expect(withTruckEta({ etaMin: 10, distanceKm: 8, source: "osrm" })).toMatchObject({
      distanceKm: 8,
      source: "osrm",
    });
  });
  it("does not stretch a straight-line fallback a second time", () => {
    expect(withTruckEta({ etaMin: 40, source: "haversine" }).etaMin).toBe(40);
  });
  it("keeps a route with no source marker (older callers) stretched like a road route", () => {
    expect(withTruckEta({ etaMin: 30 }).etaMin).toBe(truckEtaMin(30));
  });
});
