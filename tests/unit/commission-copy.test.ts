import { describe, expect, it } from "vitest";
import { COMMISSION_BASE, commissionCopy } from "@/lib/commission-copy";

describe("commissionCopy", () => {
  const price =
    "After that the commission is 7% of the full job price, materials and transport included.";
  const value =
    "Con Z commission is 7% of the full job value, materials and transport included. Next.";
  it("uses the one approved sentence whatever the pricing switch", () => {
    for (const on of [false, true]) {
      expect(commissionCopy(price, on)).toBe(`After that the commission is ${COMMISSION_BASE}.`);
      expect(commissionCopy(value, on)).toContain("total agreed job value");
    }
  });
  it("never says materials are excluded", () => {
    expect(COMMISSION_BASE).toMatch(/materials and delivery together/);
    expect(COMMISSION_BASE).not.toMatch(/not part of|excluded/);
  });
  it("does not touch other text", () => {
    expect(commissionCopy("Your first completed job has no commission.", true)).toBe(
      "Your first completed job has no commission.",
    );
  });
});
