import { describe, expect, it } from "vitest";
import {
  quickPriceBookingPath,
  quickPriceErrorMessage,
  quickPriceSignature,
} from "@/lib/quick-price";
import { safeInternalPath } from "@/lib/safe-redirect";

const harare = { lat: -17.8252, lng: 31.0335 };

describe("quickPriceSignature", () => {
  it("changes whenever an input that affects the price changes", () => {
    const base = quickPriceSignature({ material: "river_sand", quantity: 12, coords: harare });
    expect(quickPriceSignature({ material: "pit_sand", quantity: 12, coords: harare })).not.toBe(
      base,
    );
    expect(quickPriceSignature({ material: "river_sand", quantity: 13, coords: harare })).not.toBe(
      base,
    );
    expect(
      quickPriceSignature({
        material: "river_sand",
        quantity: 12,
        coords: { lat: -17.9, lng: 31.0335 },
      }),
    ).not.toBe(base);
    expect(quickPriceSignature({ material: "river_sand", quantity: 12, coords: null })).not.toBe(
      base,
    );
  });
});

describe("quickPriceBookingPath", () => {
  it("carries the checked details to the booking screen", () => {
    const path = quickPriceBookingPath({
      material: "river_sand",
      quantity: 12,
      address: "  14 Main Rd, Avondale & Belgravia  ",
      coords: harare,
    });
    const url = new URL(path, "https://example.test");
    expect(url.pathname).toBe("/customer/book");
    expect(url.searchParams.get("material")).toBe("river_sand");
    expect(url.searchParams.get("quantity")).toBe("12");
    expect(url.searchParams.get("address")).toBe("14 Main Rd, Avondale & Belgravia");
    expect(url.searchParams.get("lat")).toBe("-17.825200");
    expect(url.searchParams.get("lng")).toBe("31.033500");
  });

  it("survives the sign-in redirect check unchanged", () => {
    const path = quickPriceBookingPath({
      material: "stones",
      quantity: 6,
      address: "Gate 2",
      coords: harare,
    });
    expect(safeInternalPath(path)).toBe(path);
  });

  it("leaves out an empty address and missing coordinates", () => {
    const path = quickPriceBookingPath({
      material: "gravel",
      quantity: 3,
      address: " ",
      coords: null,
    });
    expect(path).toBe("/customer/book?material=gravel&quantity=3");
  });
});

describe("quickPriceErrorMessage", () => {
  it("says so when the phone is offline", () => {
    expect(quickPriceErrorMessage(new Error("anything"), true)).toMatch(/offline/);
  });

  it("explains a network failure instead of showing the raw browser error", () => {
    expect(quickPriceErrorMessage(new TypeError("Failed to fetch"), false)).toMatch(
      /Couldn't reach Con Z/,
    );
  });

  it("passes on the server's own message", () => {
    const msg =
      "This delivery address is too far from our service area — please choose a closer address.";
    expect(quickPriceErrorMessage(new Error(msg), false)).toBe(msg);
  });

  it("falls back to a plain retry message", () => {
    expect(quickPriceErrorMessage("boom", false)).toMatch(/try again/);
  });
});
