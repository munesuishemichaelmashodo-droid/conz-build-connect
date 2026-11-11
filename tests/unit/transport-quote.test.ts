import { describe, expect, it } from "vitest";
import { TransportQuoteInput, samePoint } from "@/lib/transport-quote.functions";

const ok = {
  pickupLat: -17.8,
  pickupLng: 31.05,
  deliveryLat: -17.93,
  deliveryLng: 31.1,
  quantity: 12,
};

describe("TransportQuoteInput", () => {
  it("accepts two points in Zimbabwe and a sensible load", () => {
    expect(TransportQuoteInput.safeParse(ok).success).toBe(true);
  });
  it("refuses a pickup or delivery outside Zimbabwe (no default place)", () => {
    expect(TransportQuoteInput.safeParse({ ...ok, pickupLat: -26.2 }).success).toBe(false);
    expect(TransportQuoteInput.safeParse({ ...ok, deliveryLng: 36 }).success).toBe(false);
  });
  it("refuses missing coordinates and non-positive or huge loads", () => {
    const { pickupLat: _omit, ...missing } = ok;
    expect(TransportQuoteInput.safeParse(missing).success).toBe(false);
    expect(TransportQuoteInput.safeParse({ ...ok, quantity: 0 }).success).toBe(false);
    expect(TransportQuoteInput.safeParse({ ...ok, quantity: 5000 }).success).toBe(false);
  });
});

describe("samePoint", () => {
  it("treats two nearly identical points as the same place", () => {
    expect(samePoint({ lat: -17.8, lng: 31.05 }, { lat: -17.80005, lng: 31.05005 })).toBe(true);
    expect(samePoint({ lat: -17.8, lng: 31.05 }, { lat: -17.93, lng: 31.1 })).toBe(false);
  });
});
