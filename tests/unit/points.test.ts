import { describe, expect, it } from "vitest";
import { formatPoints, pointsReason, type PointsEntry } from "@/lib/points";

const e = (o: Partial<PointsEntry>): PointsEntry => ({
  id: "1",
  points: 22,
  kind: "award",
  event: "delivery",
  reason: null,
  basis: { material: "river_sand", quantity_m3: 12 },
  created_at: "2026-11-03T00:00:00Z",
  ...o,
});

describe("points wording", () => {
  it("explains a delivery award from the job's own record", () => {
    expect(pointsReason(e({}))).toBe("Verified delivery: 12 m³ river sand");
  });
  it("explains referrals, adjustments and reversals", () => {
    expect(pointsReason(e({ event: "referral", basis: {} }))).toBe(
      "A person you referred qualified",
    );
    expect(pointsReason(e({ kind: "adjustment", event: null, reason: "goodwill" }))).toBe(
      "Adjustment by ConZ: goodwill",
    );
    expect(pointsReason(e({ kind: "reversal", points: -22, reason: "disputed" }))).toBe(
      "Reversed by ConZ: disputed",
    );
  });
  it("signs the numbers", () => {
    expect(formatPoints(22)).toBe("+22");
    expect(formatPoints(-5)).toBe("-5");
    expect(formatPoints(1500)).toBe("+1,500");
  });
});
