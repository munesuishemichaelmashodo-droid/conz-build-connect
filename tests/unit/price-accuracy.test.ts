import { describe, expect, it } from "vitest";
import { priceAccuracyAdvice } from "@/lib/price-accuracy";

describe("priceAccuracyAdvice", () => {
  it("holds back with too few jobs", () => {
    expect(priceAccuracyAdvice({ jobs: 3, median_gap_pct: 40 }).tone).toBe("info");
  });
  it("says close when within 10%", () => {
    expect(priceAccuracyAdvice({ jobs: 8, median_gap_pct: "-6.0" })).toMatchObject({ tone: "ok" });
  });
  it("says which way to move prices", () => {
    expect(priceAccuracyAdvice({ jobs: 8, median_gap_pct: 22 }).text).toMatch(
      /22% more.*too low.*raising/,
    );
    expect(priceAccuracyAdvice({ jobs: 8, median_gap_pct: -18 }).text).toMatch(
      /18% less.*too high.*lowering/,
    );
  });
});
