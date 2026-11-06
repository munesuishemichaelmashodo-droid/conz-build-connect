import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customerNow } from "@/lib/customer-home";
import { driverReach } from "@/lib/driver-reach";

const text = (f: string) => readFileSync(f, "utf8");

describe("customerNow: one next action from the jobs already loaded", () => {
  const j = (id: string, status: string) => ({ id, status });
  it("no jobs: nothing to put first (booking stays the main action)", () => {
    expect(customerNow([])).toBeNull();
    expect(customerNow(undefined)).toBeNull();
  });
  it("active delivery beats everything and says location depends on the driver sharing it", () => {
    const n = customerNow([j("a", "completed"), j("b", "open"), j("c", "in_progress")]);
    expect(n?.kind).toBe("in_progress");
    expect(n?.jobId).toBe("c");
    expect(n?.meaning).toMatch(/while the driver's phone is sharing/);
    expect(n?.meaning).not.toMatch(/always|live the whole/i);
  });
  it("open request never claims an offer exists and says the customer chooses", () => {
    const n = customerNow([j("a", "completed"), j("b", "open")]);
    expect(n?.kind).toBe("open");
    expect(n?.meaning).toMatch(/Nothing is accepted until you choose/);
  });
  it("accepted and completed map to their own next action", () => {
    expect(customerNow([j("a", "accepted")])?.action).toBe("Open delivery");
    expect(customerNow([j("a", "completed")])?.action).toBe("View delivery");
    expect(customerNow([j("a", "cancelled")])).toBeNull();
  });
});

describe("driver wording matches what the code does", () => {
  it("the feed button sends an offer; it does not say Accept", () => {
    const card = text("src/components/redesign/FeedJobCard.tsx");
    expect(card).toMatch(/Send offer · /);
    expect(card).not.toMatch(/`Accept \$\{/);
  });
  it("the home says open requests are not assigned jobs and the customer chooses", () => {
    expect(text("src/components/redesign/DriverHome.tsx")).toMatch(
      /customer compares offers and chooses a driver/,
    );
  });
  it("availability copy separates automatic offers from the wider request list", () => {
    const now = Date.now();
    const fresh = driverReach(
      { is_available: true, lat: 1, lng: 1, updated_at: new Date(now).toISOString() },
      now,
    );
    expect(fresh.title).toBe("Eligible for automatic offers");
    expect(fresh.detail).toMatch(/more widely/);
    for (const row of [null, { is_available: true, lat: null, lng: null, updated_at: null }]) {
      const r = driverReach(row, now);
      expect(`${r.title} ${r.detail}`).not.toMatch(/near you|nearby/i);
      expect(r.detail).toMatch(/browse open requests/);
    }
  });
  it("the next-loads card does not promise a job", () => {
    const c = text("src/components/NextLoadsCard.tsx");
    expect(c).toMatch(/does not assign you the\s+job/);
    expect(c).toMatch(/estimates/);
  });
  it("repeat booking says the price is recalculated and the previous driver may not offer", () => {
    const h = text("src/components/RoleDashboard.tsx");
    expect(h).toMatch(/price is recalculated/);
    expect(h).toMatch(/may or may not/);
  });
});
