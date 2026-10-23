import { describe, expect, it } from "vitest";
import {
  etaIfLive,
  evidenceSlots,
  locationDisplay,
  locationState,
  publicTrackSignal,
  stepState,
  tripBar,
} from "@/lib/delivery-docket";

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

describe("locationState", () => {
  const now = Date.parse("2026-10-23T10:30:00Z");
  it("is off when the driver is not sharing", () => {
    expect(locationState(null, now)).toBe("off");
    expect(locationState({ live: false, updatedAt: null }, now)).toBe("off");
  });
  it("is live for a location from the last 10 minutes", () => {
    expect(locationState({ live: true, updatedAt: "2026-10-23T10:25:00Z" }, now)).toBe("live");
    expect(locationState({ live: true, updatedAt: "2026-10-23T10:20:00Z" }, now)).toBe("live");
  });
  it("is live when a fresh update is newer than the page's last 30 s clock tick", () => {
    expect(locationState({ live: true, updatedAt: "2026-10-23T10:30:20Z" }, now)).toBe("live");
  });
  it("is stale once the last update is older than 10 minutes, or has no time", () => {
    expect(locationState({ live: true, updatedAt: "2026-10-23T10:19:59Z" }, now)).toBe("stale");
    expect(locationState({ live: true, updatedAt: "2026-10-23T07:00:00Z" }, now)).toBe("stale");
    expect(locationState({ live: true, updatedAt: null }, now)).toBe("stale");
  });
});

describe("tripBar", () => {
  const onRoad = {
    step: 2,
    status: "in_progress",
    atDropoff: false,
    location: "live" as const,
    plannedKm: 18,
  };
  it("never shows 0% when the driver is already at the site", () => {
    expect(
      tripBar({ ...onRoad, location: "off", atDropoff: true, remainingKm: null, furthestKm: null }),
    ).toEqual({ pct: 100, label: "At your site" });
  });
  it("measures progress against the priced distance, even when tracking starts late", () => {
    expect(tripBar({ ...onRoad, remainingKm: 9, furthestKm: 9 })?.pct).toBe(50);
    expect(tripBar({ ...onRoad, plannedKm: null, remainingKm: 5, furthestKm: 20 })?.pct).toBe(75);
    expect(tripBar({ ...onRoad, remainingKm: 25, furthestKm: 25 })?.pct).toBe(0);
  });
  it("says the distance is unavailable when the location is live but there is no route", () => {
    const bar = tripBar({ ...onRoad, remainingKm: null, furthestKm: null });
    expect(bar).toEqual({ pct: null, label: "Distance left isn't available right now." });
  });
  it("ignores a leftover route once the driver stops sharing", () => {
    const bar = tripBar({ ...onRoad, location: "off", remainingKm: 9, furthestKm: 9 });
    expect(bar).toEqual({ pct: null, label: "Live location is off, so progress can't be shown." });
  });
  it("ignores the route from a stale location", () => {
    const bar = tripBar({ ...onRoad, location: "stale", remainingKm: 9, furthestKm: 9 });
    expect(bar).toEqual({
      pct: null,
      label: "Progress shows again when the driver's location updates.",
    });
  });
  it("does not claim the trip has started before it has", () => {
    expect(tripBar({ ...onRoad, status: "accepted", remainingKm: 10, furthestKm: 10 })).toBeNull();
  });
  it("has no bar before pickup and a full one after delivery", () => {
    expect(tripBar({ ...onRoad, step: 1, remainingKm: null, furthestKm: null })).toBeNull();
    expect(tripBar({ ...onRoad, step: 3, remainingKm: null, furthestKm: null })?.pct).toBe(100);
  });
});

describe("locationDisplay", () => {
  it("allows Live, route and arrival time only for a live location", () => {
    expect(locationDisplay("live", "10:25")).toEqual({ live: true, staleNote: null });
    expect(locationDisplay("off", null)).toEqual({ live: false, staleNote: null });
  });
  it("gives a last-update note for a stale location", () => {
    expect(locationDisplay("stale", "10:12")).toEqual({
      live: false,
      staleNote: "Last location update 10:12. The truck may have moved since.",
    });
    expect(locationDisplay("stale", null).staleNote).toBe(
      "No recent location update. The truck may have moved since.",
    );
  });
});

describe("etaIfLive", () => {
  it("passes the route's arrival time through only while live", () => {
    expect(etaIfLive("live", 8)).toBe(8);
    expect(etaIfLive("stale", 8)).toBeNull();
    expect(etaIfLive("off", 8)).toBeNull();
    expect(etaIfLive("live", null)).toBeNull();
  });
});

describe("publicTrackSignal", () => {
  it("turns the public tracking payload into the same signal the customer screen uses", () => {
    expect(publicTrackSignal(null)).toEqual({ live: false, updatedAt: null });
    expect(publicTrackSignal({ updated_at: "2026-10-23T10:25:00Z" })).toEqual({
      live: true,
      updatedAt: "2026-10-23T10:25:00Z",
    });
  });
});

// The page re-checks every 30 s; these walk the same rules through time.
describe("tracking over time, both views", () => {
  const t0 = Date.parse("2026-10-23T10:00:00Z");
  const at = (min: number, sec = 0) => t0 + min * 60_000 + sec * 1000;
  const fresh = { live: true, updatedAt: "2026-10-23T10:00:00Z" };
  const later = { live: true, updatedAt: "2026-10-23T10:11:00Z" };
  const stopped = { live: false, updatedAt: null };
  const view = (track: { live: boolean; updatedAt: string | null } | null, now: number) => {
    const location = locationState(track, now);
    const bar = tripBar({
      step: 2,
      status: "in_progress",
      atDropoff: false,
      location,
      remainingKm: 9, // a route is always present, as the map keeps its last one
      furthestKm: 9,
      plannedKm: 18,
    });
    return {
      location,
      live: locationDisplay(location, "10:00").live,
      eta: etaIfLive(location, 8),
      pct: bar?.pct ?? null,
    };
  };

  it("customer screen: live, stale after 10 minutes on a 30 s tick, live again on a fresh update, off when stopped", () => {
    expect(view(fresh, at(0))).toEqual({ location: "live", live: true, eta: 8, pct: 50 });
    expect(view(fresh, at(9, 50))).toEqual({ location: "live", live: true, eta: 8, pct: 50 });
    // next 30 s tick crosses the 10-minute limit
    expect(view(fresh, at(10, 20))).toEqual({
      location: "stale",
      live: false,
      eta: null,
      pct: null,
    });
    // a fresh position arrives while the page is open
    expect(view(later, at(11))).toEqual({ location: "live", live: true, eta: 8, pct: 50 });
    // the driver stops sharing; the leftover route is ignored
    expect(view(stopped, at(12))).toEqual({ location: "off", live: false, eta: null, pct: null });
  });

  it("public page: missing, fresh, stale, recovered and stopped payloads", () => {
    const pub = (payload: { updated_at: string } | null, now: number) =>
      view(publicTrackSignal(payload), now);
    expect(pub(null, at(0)).location).toBe("off");
    expect(pub({ updated_at: "2026-10-23T10:00:00Z" }, at(5))).toMatchObject({
      live: true,
      eta: 8,
    });
    expect(pub({ updated_at: "2026-10-23T10:00:00Z" }, at(10, 30))).toMatchObject({
      location: "stale",
      live: false,
      eta: null,
    });
    expect(pub({ updated_at: "2026-10-23T10:11:00Z" }, at(11, 15))).toMatchObject({
      location: "live",
      eta: 8,
    });
    expect(pub(null, at(12))).toMatchObject({ location: "off", live: false, eta: null });
  });
});
