import { describe, expect, it } from "vitest";
import { evidenceSlots, stepState, tripBar } from "@/lib/delivery-docket";

describe("stepState", () => {
  it("marks earlier steps done, the active one current and later ones upcoming", () => {
    expect([0, 1, 2, 3].map((i) => stepState(i, 2))).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
    ]);
    expect([0, 1, 2, 3].map((i) => stepState(i, 4))).toEqual(["done", "done", "done", "done"]);
  });
});

describe("evidenceSlots", () => {
  it("shows both slots on an active job, with what is still needed", () => {
    const s = evidenceSlots({ status: "in_progress", pickup_photo_url: "j/p.jpg" }, "driver");
    expect(s.map((x) => [x.kind, x.uploaded])).toEqual([
      ["pickup", true],
      ["delivery", false],
    ]);
    expect(s[1].status).toBe("Needed once the load is tipped");
  });

  it("shows the customer only photos that exist", () => {
    expect(evidenceSlots({ status: "accepted" }, "customer")).toEqual([]);
    const s = evidenceSlots({ status: "in_progress", pickup_photo_url: "j/p.jpg" }, "customer");
    expect(s.map((x) => [x.kind, x.status])).toEqual([["pickup", "Uploaded at pickup"]]);
  });

  it("shows only uploaded photos once the job is finished", () => {
    expect(
      evidenceSlots(
        { status: "completed", pickup_photo_url: "a", delivery_photo_url: "b" },
        "driver",
      ),
    ).toHaveLength(2);
    expect(
      evidenceSlots({ status: "cancelled", pickup_photo_url: "a" }, "customer").map((x) => x.kind),
    ).toEqual(["pickup"]);
    expect(evidenceSlots({ status: "completed" }, "driver")).toEqual([]);
  });
});

describe("tripBar", () => {
  const onRoad = { step: 2, status: "in_progress", atDropoff: false, live: false, plannedKm: 18 };
  it("never shows 0% when the driver is already at the site", () => {
    expect(tripBar({ ...onRoad, atDropoff: true, remainingKm: null, furthestKm: null })).toEqual({
      pct: 100,
      label: "At your site",
    });
  });
  it("shows no percentage without a live route", () => {
    const bar = tripBar({ ...onRoad, remainingKm: null, furthestKm: null });
    expect(bar?.pct).toBeNull();
    expect(bar?.label).toBe("Live location is off, so progress can't be shown.");
    expect(tripBar({ ...onRoad, live: true, remainingKm: null, furthestKm: null })?.label).toBe(
      "Distance left isn't available right now.",
    );
  });
  it("measures progress against the priced distance, even when tracking starts late", () => {
    expect(tripBar({ ...onRoad, remainingKm: 9, furthestKm: 9 })?.pct).toBe(50);
    expect(tripBar({ ...onRoad, plannedKm: null, remainingKm: 5, furthestKm: 20 })?.pct).toBe(75);
    expect(tripBar({ ...onRoad, remainingKm: 25, furthestKm: 25 })?.pct).toBe(0);
  });
  it("does not claim the trip has started before it has", () => {
    expect(tripBar({ ...onRoad, status: "accepted", remainingKm: 10, furthestKm: 10 })).toBeNull();
  });
  it("has no bar before pickup and a full one after delivery", () => {
    expect(tripBar({ ...onRoad, step: 1, remainingKm: null, furthestKm: null })).toBeNull();
    expect(
      tripBar({ ...onRoad, step: 3, status: "in_progress", remainingKm: null, furthestKm: null })
        ?.pct,
    ).toBe(100);
  });
});
