import { describe, expect, it } from "vitest";
import { COMMISSION_BASE_TRANSPORT, commissionCopy } from "@/lib/commission-copy";

describe("commissionCopy", () => {
  const price =
    "After that the commission is 7% of the full job price, materials and transport included.";
  const value =
    "Con Z commission is 7% of the full job value, materials and transport included. Next.";
  it("leaves the wording alone while delivery-only pricing is off", () => {
    expect(commissionCopy(price, false)).toBe(price);
    expect(commissionCopy(value, false)).toBe(value);
  });
  it("says the commission is on the agreed delivery fare, not the materials, when it is on", () => {
    expect(commissionCopy(price, true)).toBe(
      `After that the commission is ${COMMISSION_BASE_TRANSPORT}.`,
    );
    expect(commissionCopy(value, true)).toContain("agreed delivery fare");
    expect(commissionCopy(value, true)).not.toMatch(/materials and transport included/);
  });
  it("does not touch other text", () => {
    expect(commissionCopy("Your first completed job has no commission.", true)).toBe(
      "Your first completed job has no commission.",
    );
  });
});
