import { describe, expect, it } from "vitest";
import {
  quickPriceBookingPath,
  quickPriceErrorMessage,
  quickPriceSignature,
  quickPriceStage,
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

describe("quickPriceStage", () => {
  const base = { quantityValid: true, hasDelivery: true, loading: false, result: null };

  it("asks for a valid load size first", () => {
    const s = quickPriceStage({ ...base, quantityValid: false, hasDelivery: false });
    expect(s.kind).toBe("needs_load");
    expect(s.prompt).toMatch(/load size/i);
  });

  it("asks for the delivery point when that is all that is missing", () => {
    const s = quickPriceStage({ ...base, hasDelivery: false });
    expect(s.kind).toBe("needs_delivery");
    expect(s.prompt).toMatch(/deliver/i);
  });

  it("explains that the pickup is found for the customer once ready", () => {
    const s = quickPriceStage(base);
    expect(s.kind).toBe("ready");
    expect(s.prompt).toMatch(/supplier/i);
  });

  it("is checking while a request is in flight", () => {
    expect(quickPriceStage({ ...base, loading: true }).kind).toBe("checking");
  });

  it("tells a supplier estimate apart from an open-request guide", () => {
    expect(quickPriceStage({ ...base, result: { offer: { openRequest: false } } }).kind).toBe(
      "estimate",
    );
    expect(quickPriceStage({ ...base, result: { offer: { openRequest: true } } }).kind).toBe(
      "guide",
    );
  });

  it("offers a retry after an error", () => {
    const s = quickPriceStage({ ...base, result: { error: "Couldn't reach Con Z." } });
    expect(s.kind).toBe("error");
  });

  it("never shows a price stage without a delivery point", () => {
    const s = quickPriceStage({
      ...base,
      hasDelivery: false,
      result: { offer: { openRequest: false } },
    });
    expect(s.kind).toBe("needs_delivery");
  });
});
