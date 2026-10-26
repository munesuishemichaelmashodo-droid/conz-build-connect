import { describe, expect, it } from "vitest";
import { composeOfferMessage, MAX_SOURCE_LENGTH, parseOfferMessage } from "@/lib/proposed-source";

describe("driver-proposed material source (carried in the offer message)", () => {
  it("adds the source line in front of the driver's note", () => {
    expect(composeOfferMessage("Mazowe river bed", "Can deliver today.")).toBe(
      "Loading at: Mazowe river bed. Can deliver today.",
    );
  });
  it("keeps a note alone when there is no source, and null when both are empty", () => {
    expect(composeOfferMessage("", "Can deliver today.")).toBe("Can deliver today.");
    expect(composeOfferMessage("  ", " ")).toBeNull();
  });
  it("round-trips source and note", () => {
    const m = composeOfferMessage("Pomona yard", "Morning only.");
    expect(parseOfferMessage(m)).toEqual({ source: "Pomona yard", note: "Morning only." });
  });
  it("reads plain messages (no source) unchanged", () => {
    expect(parseOfferMessage("Can load at Pomona this morning.")).toEqual({
      source: null,
      note: "Can load at Pomona this morning.",
    });
    expect(parseOfferMessage(null)).toEqual({ source: null, note: "" });
  });
  it("trims, collapses spaces and caps the source length", () => {
    const long = "x".repeat(200);
    const m = composeOfferMessage(`  ${long}  `, "");
    expect(parseOfferMessage(m).source?.length).toBe(MAX_SOURCE_LENGTH);
    expect(composeOfferMessage("Mazowe   river\nbed", "")).toBe("Loading at: Mazowe river bed.");
  });
  it("doesn't let a source contain the separator and swallow the note", () => {
    const m = composeOfferMessage("Yard. Loading at: elsewhere", "Note");
    expect(parseOfferMessage(m)).toEqual({ source: "Yard, Loading at: elsewhere", note: "Note" });
  });
});
