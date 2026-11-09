import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferCard, type OfferBid } from "@/components/redesign/OfferCard";

const bid: OfferBid = {
  id: "b1",
  price: 100,
  status: "pending",
  capacity_m3_snapshot: 15,
  truck_reg: "AEF ••••",
  truck_facts: { body_type: "tipper", make: "Isuzu", model: "FVZ", colour: "white" },
  profile: { full_name: "Tendai Moyo" },
  driver: { rating_avg: 4.8, rating_count: 5, jobs_completed: 12, verification_status: "verified" },
};

const render = (b: OfferBid) =>
  renderToStaticMarkup(createElement(OfferCard, { bid: b, primary: true, guide: null }));

describe("OfferCard truck line", () => {
  it("shows declared truck facts labelled as declared by the driver, with the masked plate", () => {
    const html = render(bid);
    expect(html).toContain("White Isuzu FVZ tipper (declared by driver)");
    expect(html).toContain("Plate AEF ••••");
  });
  it("never shows a phone number or email", () => {
    const html = render(bid);
    expect(html).not.toMatch(/tel:|mailto:|@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
  it("shows only the plate when the driver declared nothing", () => {
    const html = render({ ...bid, truck_facts: null });
    expect(html).toContain("Plate AEF ••••");
    expect(html).not.toContain("declared by driver");
  });
  it("shows no truck line when there is nothing to show", () => {
    const html = render({ ...bid, truck_facts: null, truck_reg: null });
    expect(html).not.toContain("Plate");
    expect(html).not.toContain("declared by driver");
  });
});
