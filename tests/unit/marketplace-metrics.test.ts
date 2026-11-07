import { describe, expect, it } from "vitest";
import {
  METRIC_DEFINITIONS,
  SMALL_SAMPLE_BELOW,
  formatMedianMinutes,
  formatMedianSeconds,
  formatRatio,
} from "@/lib/marketplace-metrics";

describe("formatRatio", () => {
  it("always shows the raw counts and a rounded percentage", () => {
    expect(formatRatio({ n: 30, d: 40 })).toEqual({ raw: "30 of 40", pct: "75%", small: false });
  });
  it("shows no percentage when there is no denominator", () => {
    expect(formatRatio({ n: 0, d: 0 })).toEqual({ raw: "0 of 0", pct: null, small: true });
    expect(formatRatio(null).pct).toBeNull();
  });
  it("flags small samples so a percentage is not read as a conclusion", () => {
    expect(formatRatio({ n: 2, d: SMALL_SAMPLE_BELOW - 1 }).small).toBe(true);
    expect(formatRatio({ n: 2, d: SMALL_SAMPLE_BELOW }).small).toBe(false);
  });
});

describe("medians", () => {
  it("handles missing data honestly", () => {
    expect(formatMedianMinutes(null)).toBe("No data yet");
    expect(formatMedianSeconds(undefined)).toBe("No data yet");
  });
  it("formats minutes and seconds", () => {
    expect(formatMedianMinutes(12.4)).toBe("12 min");
    expect(formatMedianMinutes(90)).toBe("1.5 h");
    expect(formatMedianSeconds(45)).toBe("45 s");
    expect(formatMedianSeconds(300)).toBe("5 min");
  });
});

describe("definitions", () => {
  it("defines every rate and keeps jobs and offers apart", () => {
    for (const k of ["with_offer", "offer_accepted", "verified_completed", "no_shows", "repeat_requests", "offers"]) {
      expect(METRIC_DEFINITIONS[k]).toBeTruthy();
    }
    expect(METRIC_DEFINITIONS.offers).toMatch(/offers, not requests/i);
    expect(METRIC_DEFINITIONS.repeat_requests).toMatch(/not loyalty/i);
  });
});
