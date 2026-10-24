import { describe, expect, it } from "vitest";
import {
  earlierOfferNote,
  guideBand,
  offerHighlights,
  priceCoversLine,
  sortOffers,
  tripsLabel,
} from "@/lib/offer-compare";

const offers = [
  { id: "a", price: 215, eta_minutes: 45, driver: { rating_avg: 4.7, rating_count: 23 } },
  { id: "b", price: 198, eta_minutes: 15, driver: { rating_avg: 0, rating_count: 0 } },
  { id: "c", price: 255, eta_minutes: null, driver: { rating_avg: 4.9, rating_count: 2 } },
  { id: "d", price: 198, eta_minutes: 60, driver: null },
];

describe("sortOffers", () => {
  it("orders by price, keeping the original order on ties", () => {
    expect(sortOffers(offers, "price").map((o) => o.id)).toEqual(["b", "d", "a", "c"]);
  });
  it("orders by soonest pickup, with no time given last", () => {
    expect(sortOffers(offers, "pickup").map((o) => o.id)).toEqual(["b", "a", "d", "c"]);
  });
  it("orders by rating, unrated drivers after rated ones, then by price", () => {
    expect(sortOffers(offers, "rating").map((o) => o.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("does not change the input array", () => {
    const copy = [...offers];
    sortOffers(offers, "pickup");
    expect(offers).toEqual(copy);
  });
});

describe("guideBand", () => {
  const range = { low: 180, high: 240 };
  it("places an offer against the trip's price range", () => {
    expect(guideBand(198, range)?.kind).toBe("within");
    expect(guideBand(240, range)?.kind).toBe("within");
    expect(guideBand(255, range)?.kind).toBe("above");
    expect(guideBand(150, range)?.kind).toBe("below");
    expect(guideBand(255, range)?.text).toBe("Above range");
  });
  it("says nothing when there is no usable range", () => {
    expect(guideBand(198, null)).toBeNull();
    expect(guideBand(198, { low: 0, high: 0 })).toBeNull();
    expect(guideBand(198, { low: 300, high: 200 })).toBeNull();
  });
});

describe("labels", () => {
  it("flags more than one trip", () => {
    expect(tripsLabel(1)).toEqual({ text: "1 trip", multiple: false });
    expect(tripsLabel(2)).toEqual({ text: "2 trips", multiple: true });
    expect(tripsLabel(null)).toEqual({ text: "1 trip", multiple: false });
  });
});

describe("offerHighlights", () => {
  it("tags the lowest price and the soonest pickup, including ties", () => {
    expect(offerHighlights(offers)).toEqual({
      b: ["Lowest price", "Soonest pickup"],
      d: ["Lowest price"],
    });
  });
  it("tags nothing for a single offer or when every offer ties", () => {
    expect(offerHighlights([offers[0]])).toEqual({});
    expect(
      offerHighlights([
        { id: "x", price: 100, eta_minutes: 20 },
        { id: "y", price: 100, eta_minutes: 20 },
      ]),
    ).toEqual({});
  });
});

describe("priceCoversLine", () => {
  it("says what the price covers only when the job's breakdown shows it", () => {
    expect(
      priceCoversLine({ material_component: 120, transport_component: 87 }, "12 m³ river sand"),
    ).toBe("Each price is the total for 12 m³ river sand, delivered to your site.");
    expect(priceCoversLine({ material_component: 0, transport_component: 87 }, "x")).toBe(
      "Each price is for delivery to your site.",
    );
    expect(priceCoversLine(null, "x")).toBeNull();
  });
});

describe("earlierOfferNote", () => {
  it("explains why an offer can no longer be chosen", () => {
    expect(earlierOfferNote("pending")).toBe("Expired. The driver can send it again.");
    expect(earlierOfferNote("withdrawn")).toBe("Withdrawn by the driver");
    expect(earlierOfferNote("rejected")).toBe("Not chosen");
  });
});
