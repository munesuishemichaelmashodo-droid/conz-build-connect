import { describe, expect, it } from "vitest";
import { TRUCK_BODY_TYPES, truckFactsLine } from "@/lib/truck-facts";

describe("truckFactsLine", () => {
  it("joins colour, make, model and body type in plain words", () => {
    expect(
      truckFactsLine({ body_type: "tipper", make: "Isuzu", model: "FVZ", colour: "white" }),
    ).toBe("White Isuzu FVZ tipper");
  });
  it("skips what the driver has not given", () => {
    expect(truckFactsLine({ body_type: "tipper", make: null, model: null, colour: null })).toBe(
      "Tipper",
    );
    expect(truckFactsLine({ make: "Hino" })).toBe("Hino");
  });
  it("returns null when nothing was declared", () => {
    expect(truckFactsLine({})).toBeNull();
    expect(truckFactsLine(null)).toBeNull();
    expect(truckFactsLine({ make: "  ", model: "" })).toBeNull();
  });
  it("does not repeat the body type already written in the model", () => {
    expect(truckFactsLine({ body_type: "tipper", model: "Tipper 6x4" })).toBe("Tipper 6x4");
  });
  it("offers the same body types the database accepts", () => {
    expect(TRUCK_BODY_TYPES.map((t) => t.value)).toEqual([
      "tipper",
      "dropside",
      "flatbed",
      "other",
    ]);
  });
});
