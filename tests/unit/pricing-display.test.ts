import { describe, expect, it } from "vitest";
import { priceFreshness } from "@/lib/pricing-display";

const NOW = new Date("2026-10-26T08:00:00Z");

describe("priceFreshness", () => {
  it("marks prices older than 30 days as stale (production: 13 Aug 2026)", () => {
    const f = priceFreshness("2026-08-13T10:00:00Z", NOW);
    expect(f).toMatchObject({ state: "stale", days: 73, label: "13 Aug 2026" });
  });
  it("treats recent prices as fresh", () => {
    expect(priceFreshness("2026-10-20T10:00:00Z", NOW)).toMatchObject({ state: "fresh", days: 5 });
  });
  it("is unknown when the engine doesn't say (older engine) or the date is junk", () => {
    expect(priceFreshness(null, NOW)).toEqual({ state: "unknown" });
    expect(priceFreshness("nope", NOW)).toEqual({ state: "unknown" });
  });
});
