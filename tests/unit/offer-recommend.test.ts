import { describe, expect, it } from "vitest";
import { recommendOffer, scoreOffer, sortOffers } from "@/lib/offer-compare";

const range = { low: 160, high: 230 };

// A cheap offer from a driver with no history and a poor truck fit...
const cheap = {
  id: "cheap",
  price: 140,
  eta_minutes: 90,
  capacity_match_tier: "multiple_trips",
  driver: { rating_avg: 0, rating_count: 0, jobs_completed: 0 },
};
// ...against a slightly dearer, in-range offer from a proven driver with the right truck.
const solid = {
  id: "solid",
  price: 185,
  eta_minutes: 25,
  capacity_match_tier: "excellent",
  profile: { last_active_at: new Date().toISOString() },
  driver: {
    rating_avg: 4.8,
    rating_count: 12,
    jobs_completed: 20,
    verification_status: "verified",
  },
};
const ok = {
  id: "ok",
  price: 195,
  eta_minutes: 60,
  capacity_match_tier: "good",
  driver: { rating_avg: 4.1, rating_count: 5, jobs_completed: 4 },
};

describe("recommendOffer", () => {
  it("needs at least two live offers", () => {
    expect(recommendOffer([], range)).toBeNull();
    expect(recommendOffer([solid], range)).toBeNull();
  });

  it("prefers the reliable, well-fitting, in-range offer over the cheapest one", () => {
    const r = recommendOffer([cheap, ok, solid], range);
    expect(r?.id).toBe("solid");
  });

  it("explains itself in plain words, at most three reasons", () => {
    const r = recommendOffer([cheap, ok, solid], range)!;
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.length).toBeLessThanOrEqual(3);
    expect(r.reasons.join(" ")).toMatch(/range|fit|rated|jobs|reach/i);
  });

  it("stays silent when no offer is clearly better (no false authority)", () => {
    const a = {
      id: "a",
      price: 190,
      driver: { rating_avg: 4.6, rating_count: 6, jobs_completed: 5 },
    };
    const b = {
      id: "b",
      price: 192,
      driver: { rating_avg: 4.6, rating_count: 7, jobs_completed: 5 },
    };
    expect(recommendOffer([a, b], range)).toBeNull();
  });

  it("works when information is missing (no range, no driver, no tier)", () => {
    const a = { id: "a", price: 100 };
    const b = { id: "b", price: 120 };
    expect(() => recommendOffer([a, b], null)).not.toThrow();
  });
});

describe("scoreOffer", () => {
  it("penalises a price above the expected range and rewards one inside it", () => {
    const base = { id: "x", driver: null };
    const inside = scoreOffer(
      { ...base, price: 200 },
      { lowestPrice: 200, breakdown: range },
    ).score;
    const above = scoreOffer({ ...base, price: 300 }, { lowestPrice: 300, breakdown: range }).score;
    expect(inside).toBeGreaterThan(above);
  });

  it("never rewards an unrated driver for being unrated", () => {
    const s = scoreOffer(
      { id: "u", price: 200, driver: { rating_avg: 0, rating_count: 0, jobs_completed: 0 } },
      { lowestPrice: 200, breakdown: null },
    );
    expect(s.reasons.join(" ")).not.toMatch(/rated/i);
  });
});

describe("sortOffers 'best'", () => {
  it("puts the recommended offer first and keeps price as the tie-breaker", () => {
    const order = sortOffers([cheap, ok, solid], "best", range).map((o) => o.id);
    expect(order[0]).toBe("solid");
    expect(order).toHaveLength(3);
  });

  it("falls back to price order when nothing separates the offers", () => {
    const a = { id: "a", price: 200 };
    const b = { id: "b", price: 150 };
    expect(sortOffers([a, b], "best", null).map((o) => o.id)).toEqual(["b", "a"]);
  });
});
