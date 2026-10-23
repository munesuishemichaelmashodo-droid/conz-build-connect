import { describe, expect, it } from "vitest";
import { evidenceSlots, stepState } from "@/lib/delivery-docket";

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
