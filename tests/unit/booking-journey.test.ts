import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_JOURNEY,
  SERVICES,
  feedJourneyTag,
  jobKindLabel,
  journeyJobFields,
  journeyProblem,
  requestOfferProblem,
  timeLabel,
  truckLabel,
  type JourneyInput,
} from "@/lib/booking-journey";
import { transportRequestJobFields, transportRequestOfferResult } from "@/lib/transport-offer-view";

const j = (over: Partial<JourneyInput>): JourneyInput => ({ ...EMPTY_JOURNEY, ...over });
const t = (over: Partial<JourneyInput>) =>
  j({ service: "transport", loadDescription: "Bricks", ...over });

describe("the first choice", () => {
  it("offers exactly transport only and materials and transport", () => {
    expect(SERVICES.map((s) => s.value)).toEqual(["transport", "materials"]);
    expect(SERVICES[0].title).toBe("Transport only");
    expect(SERVICES[1].title).toBe("Materials and transport");
  });
  it("requires an explicit choice", () => {
    expect(journeyProblem(EMPTY_JOURNEY)).toMatch(/Choose what you need/);
  });
  it("materials and transport needs none of the transport fields", () => {
    expect(journeyProblem(j({ service: "materials" }))).toBeNull();
  });
});

describe("journeyProblem (transport only)", () => {
  it("needs a description of the load", () => {
    expect(journeyProblem(j({ service: "transport" }))).toMatch(/what the driver is moving/);
    expect(journeyProblem(t({ loadDescription: " x " }))).toMatch(/what the driver is moving/);
    expect(journeyProblem(t({ kind: "transport_only" }))).toBeNull();
  });
  it("collect needs the shop or place name", () => {
    expect(journeyProblem(t({ kind: "collect_and_deliver" }))).toMatch(/name of the shop or place/);
    expect(journeyProblem(t({ kind: "collect_and_deliver", collectionName: " A " }))).toMatch(
      /shop or place/,
    );
    expect(
      journeyProblem(t({ kind: "collect_and_deliver", collectionName: "Halsted" })),
    ).toBeNull();
  });
  it("refuses over-long and control-character text, as the database does", () => {
    expect(
      journeyProblem(t({ kind: "collect_and_deliver", collectionName: "x".repeat(121) })),
    ).toMatch(/too long/);
    expect(journeyProblem(t({ loadDetails: "a\nb" }))).toMatch(/not allowed/);
    expect(journeyProblem(t({ loadDescription: "x".repeat(121) }))).toMatch(/too long/);
    expect(
      journeyProblem(
        t({
          kind: "collect_and_deliver",
          collectionName: "Shop",
          collectionReference: "r".repeat(81),
        }),
      ),
    ).toMatch(/too long/);
  });
});

describe("journeyJobFields", () => {
  const collect = t({
    kind: "collect_and_deliver",
    collectionName: " Halsted ",
    collectionContact: "Store, 0772",
    collectionReference: "INV-1",
    loadDescription: " Roof sheets ",
    loadDetails: "",
    truck: "flatbed",
    time: "morning",
  });
  it("saves the collect journey, trimmed, with empty strings as null", () => {
    expect(journeyJobFields(collect)).toEqual({
      job_kind: "collect_and_deliver",
      custom_material: "Roof sheets",
      load_details: null,
      truck_requirement: "flatbed",
      preferred_time: "morning",
      collection_name: "Halsted",
      collection_contact: "Store, 0772",
      collection_reference: "INV-1",
    });
  });
  it("switching to transport only leaves no shop details behind", () => {
    const f = journeyJobFields({ ...collect, kind: "transport_only" });
    expect(f.collection_name).toBeNull();
    expect(f.collection_contact).toBeNull();
    expect(f.collection_reference).toBeNull();
    expect(f.job_kind).toBe("transport_only");
  });
  it("uses the customer's own description, never a catalogue material", () => {
    expect(journeyJobFields(t({ loadDescription: "2,000 bricks" })).custom_material).toBe(
      "2,000 bricks",
    );
  });
});

describe("unpriced transport request (transport pricing off)", () => {
  it("shows no Con Z price or guide range", () => {
    const o = transportRequestOfferResult(25);
    expect(o.dataSource).toBe("transport_request");
    expect(o.openRequest).toBe(true);
    expect(o.offer).toBe(0);
    expect(o.quoteId).toBeNull();
    expect([o.low, o.recommended, o.high].every((v) => Number.isNaN(v))).toBe(true);
    expect(o.materialCost).toBe(0);
  });
  it("posts as a transport request with no material and no quote", () => {
    expect(transportRequestJobFields({ address: " 12 Main St ", lat: -17.8, lng: 31.05 })).toEqual({
      material: "custom",
      quote_id: null,
      transport_quote_id: null,
      pricing_basis: "transport_request",
      pickup_address: "12 Main St",
      pickup_lat: -17.8,
      pickup_lng: 31.05,
    });
  });
  it("needs the customer's own offer between $1 and $100,000, in cents", () => {
    expect(requestOfferProblem(0)).toMatch(/Enter the amount/);
    expect(requestOfferProblem(Number.NaN)).toMatch(/Enter the amount/);
    expect(requestOfferProblem(-5)).toMatch(/Enter the amount/);
    expect(requestOfferProblem(100001)).toMatch(/most you can offer/);
    expect(requestOfferProblem(12.345)).toMatch(/cents/);
    expect(requestOfferProblem(150)).toBeNull();
    expect(requestOfferProblem(99.99)).toBeNull();
  });
});

describe("booking screen wiring", () => {
  const book = readFileSync("src/routes/_authenticated/customer.book.tsx", "utf8");
  it("always shows the first choice, not only when transport pricing is on", () => {
    expect(book).toMatch(/<ServiceChoice value=\{journey\} onChange=\{setJourney\} \/>/);
    expect(book).not.toMatch(/transportOn && <ServiceChoice/);
    expect(book).not.toMatch(/transportOn && <JourneyChoice/);
  });
  it("shows the material catalogue only for materials and transport", () => {
    expect(book).toMatch(/journey\.service === "materials" && \(\s*<div id="tour-book-material"/);
  });
  it("never calls the material pricing or sourcing for transport only", () => {
    const go = book.slice(book.indexOf("const goToOffer"), book.indexOf("const nextStep"));
    const transportBranch = go.slice(
      go.indexOf("if (isTransport)"),
      go.indexOf("setComputing(true);\n\n    try {"),
    );
    expect(transportBranch).toMatch(/return;\s*\}\s*$/);
    expect(transportBranch).not.toMatch(/runOffer|runSourcing|attemptKey/);
  });
});

describe("labels", () => {
  it("names the journeys and hides 'any'", () => {
    expect(jobKindLabel("transport_only")).toMatch(/Transport only/);
    expect(jobKindLabel("collect_and_deliver")).toBe("Customer-arranged collection");
    expect(jobKindLabel(null)).toBeNull();
    expect(truckLabel("any")).toBeNull();
    expect(truckLabel("tipper")).toBe("Tipper");
    expect(timeLabel("afternoon")).toBe("Afternoon");
    expect(timeLabel("any")).toBeNull();
  });
});

describe("feedJourneyTag", () => {
  it("shows type and truck only", () => {
    expect(feedJourneyTag("transport_only", "flatbed")).toBe("Transport only · Flatbed");
    expect(feedJourneyTag("collect_and_deliver", "any")).toBe("Customer-arranged collection");
    expect(feedJourneyTag("collect_and_deliver", "tipper")).toBe(
      "Customer-arranged collection · Tipper",
    );
    expect(feedJourneyTag(null, "tipper")).toBeNull();
  });
});
