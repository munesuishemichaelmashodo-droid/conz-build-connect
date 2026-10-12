import { describe, expect, it } from "vitest";
import {
  normalizeStockStatus,
  stockStatusCopy,
  supplyConfirmedCopy,
} from "../../src/lib/stockStatus";

describe("stockStatusCopy", () => {
  it("treats anything unexpected as unknown, never as available", () => {
    for (const v of [undefined, null, "", "in_stock", "available", 7, {}]) {
      expect(normalizeStockStatus(v)).toBe("unknown");
      expect(stockStatusCopy(v).title).toBe("Availability not yet confirmed");
    }
  });
  it("labels recorded stock as an estimate, not a promise", () => {
    const c = stockStatusCopy("confirmed");
    expect(c.title).toBe("Estimated availability");
    expect(c.detail).toMatch(/estimate/i);
    expect(c.detail).toMatch(/confirms the supply at loading/i);
  });
  it("flags lower-than-requested recorded stock as to be confirmed", () => {
    const c = stockStatusCopy("below_requested");
    expect(c.tone).toBe("warn");
    expect(c.title).toBe("Availability to be confirmed");
  });
  it("never uses 'in stock' / 'available now' wording for unconfirmed supply", () => {
    for (const v of ["unknown", "confirmed", "below_requested"]) {
      const c = stockStatusCopy(v);
      expect(`${c.title} ${c.detail}`).not.toMatch(/in stock|available now|guaranteed/i);
    }
  });
  it("names who confirmed", () => {
    expect(supplyConfirmedCopy("admin")).toBe("Supply confirmed by ConZ");
    expect(supplyConfirmedCopy("driver")).toBe("Supply confirmed by your driver");
  });
});
