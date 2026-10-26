import { describe, expect, it } from "vitest";
import {
  commissionFee,
  DEFAULT_FUEL_L_PER_100KM,
  earnings,
  fuelEstimate,
  tripsFor,
} from "@/lib/driver-economics";

describe("commissionFee (mirrors commission_amount: round(price × rate / 100, 2))", () => {
  it("charges 7% to the cent", () => {
    expect(commissionFee(230, 7, false)).toBe(16.1);
    expect(commissionFee(194, 7, false)).toBe(13.58);
  });
  it("rounds halves away from zero like Postgres", () => {
    expect(commissionFee(7.5, 7, false)).toBe(0.53); // 0.525
    expect(commissionFee(12.35, 7, false)).toBe(0.86); // 0.8645
    expect(commissionFee(10.05, 7, false)).toBe(0.7); // 0.7035 (float would drift)
  });
  it("handles fractional rates", () => {
    expect(commissionFee(200, 7.5, false)).toBe(15);
  });
  it("is free on the first completed job", () => {
    expect(commissionFee(230, 7, true)).toBe(0);
  });
  it("refuses impossible inputs", () => {
    expect(commissionFee(-1, 7, false)).toBeNull();
    expect(commissionFee(100, 101, false)).toBeNull();
    expect(commissionFee(Number.NaN, 7, false)).toBeNull();
  });
});

describe("tripsFor (mirrors tg_stamp_bid_capacity: ceil(qty / capacity))", () => {
  it("one trip when the truck holds the load", () => {
    expect(tripsFor(12, 16)).toBe(1);
    expect(tripsFor(16, 16)).toBe(1);
  });
  it("multiple trips for large loads", () => {
    expect(tripsFor(25, 10)).toBe(3);
    expect(tripsFor(30, 20)).toBe(2);
  });
  it("refuses invalid capacity or quantity", () => {
    expect(tripsFor(12, 0)).toBeNull();
    expect(tripsFor(12, -5)).toBeNull();
    expect(tripsFor(0, 10)).toBeNull();
    expect(tripsFor(Number.NaN, 10)).toBeNull();
  });
});

describe("fuelEstimate", () => {
  const base = {
    routeKm: 25,
    routeIsRoad: true,
    trips: 1,
    litresPer100km: null,
    dieselPerLitre: 1.87,
  };
  it("counts the loaded leg and the empty return for every trip", () => {
    const f = fuelEstimate(base);
    expect(f.available).toBe(true);
    if (!f.available) return;
    expect(f.km).toBe(50);
    expect(f.litres).toBe(16); // 50 km × 32 L / 100 km
    expect(f.cost).toBe(29.92); // 16 L × $1.87
    expect(f.assumptions.join(" ")).toMatch(/32 L per 100 km/);
    expect(f.excluded.join(" ")).toMatch(/first pickup/);
  });
  it("scales with trips", () => {
    const f = fuelEstimate({ ...base, trips: 3 });
    expect(f.available && f.km).toBe(150);
  });
  it("uses a valid fuel setting and ignores an impossible one", () => {
    const ok = fuelEstimate({ ...base, litresPer100km: 40 });
    expect(ok.available && ok.litres).toBe(20);
    const bad = fuelEstimate({ ...base, litresPer100km: 500 });
    expect(bad.available && bad.litres).toBe((50 * DEFAULT_FUEL_L_PER_100KM) / 100);
  });
  it("says why it can't estimate (route failure, no truck, no diesel price)", () => {
    expect(fuelEstimate({ ...base, routeKm: null }).available).toBe(false);
    expect(fuelEstimate({ ...base, routeKm: 0 }).available).toBe(false);
    expect(fuelEstimate({ ...base, trips: null }).available).toBe(false);
    expect(fuelEstimate({ ...base, dieselPerLitre: null }).available).toBe(false);
    expect(fuelEstimate({ ...base, dieselPerLitre: 0 }).available).toBe(false);
    expect(fuelEstimate({ ...base, dieselPerLitre: 101 }).available).toBe(false);
  });
  it("accepts any diesel price the admin setter allows (up to $100/L)", () => {
    const f = fuelEstimate({ ...base, dieselPerLitre: 12 });
    expect(f.available && f.cost).toBe(192); // 16 L × $12
  });
  it("labels a straight-line distance as such", () => {
    const f = fuelEstimate({ ...base, routeIsRoad: false });
    expect(f.available && f.assumptions[0]).toMatch(/straight line/);
  });
});

describe("earnings", () => {
  it("shows what's left after the fee and after estimated fuel", () => {
    const fuel = fuelEstimate({
      routeKm: 25,
      routeIsRoad: true,
      trips: 1,
      litresPer100km: null,
      dieselPerLitre: 1.87,
    });
    expect(earnings(230, 16.1, fuel)).toEqual({ afterFee: 213.9, afterFuel: 183.98 });
  });
  it("has no after-fuel figure when fuel can't be estimated", () => {
    expect(earnings(230, 0, { available: false, reason: "x" })).toEqual({
      afterFee: 230,
      afterFuel: null,
    });
  });
  it("is null without a price or fee", () => {
    expect(earnings(0, 0, null)).toBeNull();
    expect(earnings(230, null, null)).toBeNull();
  });
});
