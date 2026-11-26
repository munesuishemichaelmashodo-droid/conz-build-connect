import { describe, expect, it } from "vitest";
import {
  EMPTY_JOURNEY,
  jobKindLabel,
  journeyJobFields,
  journeyProblem,
  timeLabel,
  truckLabel,
  type JourneyInput,
} from "@/lib/booking-journey";

const j = (over: Partial<JourneyInput>): JourneyInput => ({ ...EMPTY_JOURNEY, ...over });

describe("journeyProblem", () => {
  it("requires an explicit choice", () => {
    expect(journeyProblem(EMPTY_JOURNEY)).toMatch(/Choose what you need/);
  });
  it("transport only needs nothing else", () => {
    expect(journeyProblem(j({ kind: "transport_only" }))).toBeNull();
  });
  it("collect needs the supplier name", () => {
    expect(journeyProblem(j({ kind: "collect_and_deliver" }))).toMatch(
      /supplier, shop or place name/,
    );
    expect(journeyProblem(j({ kind: "collect_and_deliver", collectionName: " A " }))).toMatch(
      /supplier/,
    );
    expect(
      journeyProblem(j({ kind: "collect_and_deliver", collectionName: "Halsted" })),
    ).toBeNull();
  });
  it("refuses over-long and control-character text, as the database does", () => {
    expect(
      journeyProblem(j({ kind: "collect_and_deliver", collectionName: "x".repeat(121) })),
    ).toMatch(/too long/);
    expect(journeyProblem(j({ kind: "transport_only", loadDetails: "a\nb" }))).toMatch(
      /not allowed/,
    );
    expect(
      journeyProblem(
        j({
          kind: "collect_and_deliver",
          collectionName: "Shop",
          collectionReference: "r".repeat(81),
        }),
      ),
    ).toMatch(/too long/);
  });
});

describe("journeyJobFields", () => {
  const collect = j({
    kind: "collect_and_deliver",
    collectionName: " Halsted ",
    collectionContact: "Store, 0772",
    collectionReference: "INV-1",
    loadDescription: "Roof sheets",
    loadDetails: "",
    truck: "flatbed",
    time: "morning",
  });
  it("saves the collect journey, trimmed, with empty strings as null", () => {
    expect(journeyJobFields(collect, "River sand")).toEqual({
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
  it("switching to transport only leaves no supplier details behind", () => {
    const f = journeyJobFields({ ...collect, kind: "transport_only" }, "River sand");
    expect(f.collection_name).toBeNull();
    expect(f.collection_contact).toBeNull();
    expect(f.collection_reference).toBeNull();
    expect(f.job_kind).toBe("transport_only");
  });
  it("falls back to the chosen material as the description", () => {
    expect(journeyJobFields(j({ kind: "transport_only" }), "Bricks").custom_material).toBe(
      "Bricks",
    );
  });
});

describe("labels", () => {
  it("names the journeys and hides 'any'", () => {
    expect(jobKindLabel("transport_only")).toMatch(/Transport only/);
    expect(jobKindLabel("collect_and_deliver")).toMatch(/supplier/);
    expect(jobKindLabel(null)).toBeNull();
    expect(truckLabel("any")).toBeNull();
    expect(truckLabel("tipper")).toBe("Tipper");
    expect(timeLabel("afternoon")).toBe("Afternoon");
    expect(timeLabel("any")).toBeNull();
  });
});
