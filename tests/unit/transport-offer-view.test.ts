import { describe, expect, it } from "vitest";
import { transportJobFields, transportToOfferResult } from "@/lib/transport-offer-view";
import type { TransportOffer } from "@/lib/transport-quote.functions";

const t: TransportOffer = {
  quoteId: "q1",
  roadKm: 117,
  trips: 1,
  perTrip: { low: 120.52, recommended: 141.79, high: 163.06 },
  total: { low: 120.52, recommended: 141.79, high: 163.06 },
  calibration: "uncalibrated",
  note: "Estimate for a car-profile road route; confirm suitability for a loaded truck. Not a quote.",
};

describe("transportToOfferResult", () => {
  it("prices the delivery only: no material line, no supplier, no invented arrival time", () => {
    const o = transportToOfferResult(t, 12);
    expect(o.materialCost).toBe(0);
    expect(o.transportCost).toBe(141.79);
    expect(o.resolvedSource).toBeNull();
    expect(o.openRequest).toBe(false);
    expect(o.etaMinutes).toBe(0);
    expect(o.min).toBe(120.52);
    expect(o.max).toBe(163.06);
    expect(o.quoteId).toBe("q1");
  });
  it("keeps the caveat about the car-profile route in front of the customer", () => {
    expect(transportToOfferResult(t, 12).explanation).toMatch(/car-profile/);
  });
});

describe("transportJobFields", () => {
  it("keeps the customer's own pickup point and links the transport quote, not a supplier quote", () => {
    const f = transportJobFields(transportToOfferResult(t, 12), {
      address: "  Norton quarry road ",
      lat: -17.8,
      lng: 31.05,
    });
    expect(f.pricing_basis).toBe("transport_only");
    expect(f.transport_quote_id).toBe("q1");
    expect(f.quote_id).toBeNull();
    expect(f.pickup_address).toBe("Norton quarry road");
    expect(f.pickup_lat).toBe(-17.8);
  });
  it("never leaves the pickup address empty", () => {
    const f = transportJobFields(transportToOfferResult(t, 12), {
      address: " ",
      lat: -17.8,
      lng: 31.05,
    });
    expect(f.pickup_address.length).toBeGreaterThan(3);
  });
});
