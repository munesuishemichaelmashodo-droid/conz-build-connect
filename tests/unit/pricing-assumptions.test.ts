import { describe, expect, it } from "vitest";
import {
  DIESEL_FALLBACK_PER_LITRE,
  resolveDiesel,
  resolveFuel,
  resolveMarkup,
  settingNumber,
} from "@/lib/pricing-assumptions";

// Mirrors compute_material_offer (0127): same valid ranges, same fallbacks.
describe("pricing assumptions", () => {
  it("uses a saved diesel price as is (production $1.87 stays)", () => {
    expect(resolveDiesel(1.87)).toEqual({ value: 1.87, source: "setting" });
    expect(resolveDiesel("1.87")).toEqual({ value: 1.87, source: "setting" });
  });
  it("falls back to $2.04 for a missing or invalid diesel price", () => {
    for (const raw of [null, undefined, 0, -1, 101, "abc", "", {}]) {
      expect(resolveDiesel(raw)).toEqual({ value: DIESEL_FALLBACK_PER_LITRE, source: "default" });
    }
    expect(DIESEL_FALLBACK_PER_LITRE).toBe(2.04);
  });
  it("fuel use is valid 10–80, else 32", () => {
    expect(resolveFuel(34)).toEqual({ value: 34, source: "setting" });
    expect(resolveFuel(9).value).toBe(32);
    expect(resolveFuel(90).value).toBe(32);
    expect(resolveFuel(null).source).toBe("default");
  });
  it("long-haul allowance is valid 1–3, else 1.87", () => {
    expect(resolveMarkup(2)).toEqual({ value: 2, source: "setting" });
    expect(resolveMarkup(4).value).toBe(1.87);
  });
  it("only plain numbers count", () => {
    expect(settingNumber("1e3")).toBeNull();
    expect(settingNumber(" 2.5 ")).toBe(2.5);
    expect(settingNumber(Number.NaN)).toBeNull();
  });
});
