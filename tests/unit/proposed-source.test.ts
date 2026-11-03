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

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isDriverArranged, offerMessageParts } from "@/lib/proposed-source";
import { OfferMessage } from "@/components/redesign/ProposedSource";

describe("proposed source: where it may appear", () => {
  it("treats a job without a pickup pin as driver-arranged", () => {
    expect(isDriverArranged({ pickup_lat: null, pickup_lng: null })).toBe(true);
    expect(isDriverArranged({ pickup_lat: -17.8, pickup_lng: null })).toBe(true);
    expect(isDriverArranged({ pickup_lat: -17.8, pickup_lng: 31.0 })).toBe(false);
    expect(isDriverArranged(null)).toBe(false);
  });
  it("on a job with a listed supplier, a typed 'Loading at:' stays part of the note", () => {
    const m = "Loading at: my yard. Cheap.";
    expect(offerMessageParts(m, false)).toEqual({ source: null, note: m });
    expect(offerMessageParts(m, true)).toEqual({ source: "my yard", note: "Cheap." });
  });
});

describe("OfferMessage rendering", () => {
  const html = (message: string | null, driverArranged: boolean) =>
    renderToStaticMarkup(createElement(OfferMessage, { message, driverArranged }));

  it("always labels the source as the driver's choice, not checked by Con Z", () => {
    const out = html(composeOfferMessage("Mazowe river bed", "Today"), true);
    expect(out).toContain("Loads at: ");
    expect(out).toContain("Mazowe river bed");
    expect(out).toContain("not checked by Con Z");
  });
  it("escapes markup in the source and the note", () => {
    const out = html(composeOfferMessage("<img src=x onerror=alert(1)>", "<b>hi</b>"), true);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;img");
  });
  it("shows no source line on a supplier job, and nothing for an empty message", () => {
    expect(html("Loading at: yard. Note", false)).not.toContain("not checked by Con Z");
    expect(html(null, true)).toBe("");
    expect(html("   ", true)).toBe("");
  });
  it("an old plain message shows as a note with no source label", () => {
    const out = html("Can deliver this afternoon.", true);
    expect(out).toContain("Can deliver this afternoon.");
    expect(out).not.toContain("Loads at");
  });
});
