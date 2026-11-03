import { describe, expect, it } from "vitest";
import {
  isValidQuantity,
  loadHint,
  MAX_QUANTITY_M3,
  MIN_QUANTITY_M3,
  stepQuantity,
  tripsEstimate,
} from "@/lib/load-size";

describe("load size rules", () => {
  it("accepts the same range as booking", () => {
    expect(MIN_QUANTITY_M3).toBe(0.25);
    expect(MAX_QUANTITY_M3).toBe(30);
    expect(isValidQuantity(0.25)).toBe(true);
    expect(isValidQuantity(30)).toBe(true);
    expect(isValidQuantity(0)).toBe(false);
    expect(isValidQuantity(31)).toBe(false);
    expect(isValidQuantity(Number.NaN)).toBe(false);
  });

  it("steps by a quarter below 1 m³ and by one above, inside the limits", () => {
    expect(stepQuantity(12, 1)).toBe(13);
    expect(stepQuantity(12, -1)).toBe(11);
    expect(stepQuantity(1, -1)).toBe(0.75);
    expect(stepQuantity(0.5, 1)).toBe(0.75);
    expect(stepQuantity(0.25, -1)).toBe(0.25);
    expect(stepQuantity(30, 1)).toBe(30);
  });

  it("estimates trips like the pricing engine's reference truck", () => {
    expect(tripsEstimate(20)).toBe(1);
    expect(tripsEstimate(21)).toBe(3);
    expect(tripsEstimate(30)).toBe(3);
    expect(loadHint(12)).toBe("About 1 tipper load");
    expect(loadHint(25)).toBe("About 3 tipper loads");
    expect(loadHint(40)).toBe("Between 0.25 and 30 m³");
  });
});
