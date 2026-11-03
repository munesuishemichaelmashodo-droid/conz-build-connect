import { describe, expect, it } from "vitest";
import { dayGroup, groupByDay, notificationCategory, notificationDestination } from "@/lib/notifications";

describe("notification categories", () => {
  it("sorts types into Jobs, Payments, Verification and Account", () => {
    expect(notificationCategory("bid_accepted")).toBe("jobs");
    expect(notificationCategory("new_message")).toBe("jobs");
    expect(notificationCategory("wallet_topup")).toBe("payments");
    expect(notificationCategory("promo_credit")).toBe("payments");
    expect(notificationCategory("driver_verification")).toBe("verification");
    expect(notificationCategory("verification_overdue")).toBe("verification");
    expect(notificationCategory("admin_signin")).toBe("account");
    expect(notificationCategory("something_new")).toBe("account");
  });
});

describe("day groups (Africa/Harare)", () => {
  const now = new Date("2026-11-03T10:00:00Z"); // 12:00 in Harare
  it("groups by the Harare calendar day, not UTC", () => {
    expect(dayGroup("2026-11-03T00:30:00Z", now)).toBe("Today"); // 02:30 Harare, same day
    expect(dayGroup("2026-11-02T23:00:00Z", now)).toBe("Today"); // 01:00 Harare on the 3rd
    expect(dayGroup("2026-11-02T20:00:00Z", now)).toBe("Yesterday"); // 22:00 Harare on the 2nd
    expect(dayGroup("2026-10-30T10:00:00Z", now)).toBe("Earlier");
  });
  it("keeps the order Today, Yesterday, Earlier and drops empty groups", () => {
    const g = groupByDay(
      [{ created_at: "2026-10-01T00:00:00Z" }, { created_at: "2026-11-03T08:00:00Z" }],
      now,
    );
    expect(g.map((x) => x.label)).toEqual(["Today", "Earlier"]);
  });
});

describe("destinations", () => {
  const n = (type: string, job_id: string | null = null) => ({ id: "1", type, job_id, created_at: "" });
  it("opens the exact screen", () => {
    expect(notificationDestination(n("wallet_topup"))).toEqual({ to: "/wallet" });
    expect(notificationDestination(n("promo_credit"))).toEqual({ to: "/wallet" });
    expect(notificationDestination(n("verification_submitted"))).toEqual({ to: "/admin/verifications" });
    expect(notificationDestination(n("driver_verification"))).toEqual({ to: "/profile" });
    expect(notificationDestination(n("new_message", "j1"))).toEqual({ to: "/chat/$jobId", params: { jobId: "j1" } });
    expect(notificationDestination(n("bid_accepted", "j1"))).toEqual({ to: "/jobs/$id", params: { id: "j1" } });
    expect(notificationDestination(n("admin_signin"))).toBeNull();
  });
});
