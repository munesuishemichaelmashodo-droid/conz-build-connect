import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dayGroup,
  groupByDay,
  notificationCategory,
  notificationDestination,
  notificationHint,
  applyUpdated,
  isMissingArchiveColumn,
  mergeInserted,
  unreadCount,
  visibleNotifications,
} from "@/lib/notifications";

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
  const n = (type: string, job_id: string | null = null) => ({
    id: "1",
    type,
    job_id,
    created_at: "",
  });
  it("opens the exact screen", () => {
    expect(notificationDestination(n("wallet_topup"))).toEqual({ to: "/wallet" });
    expect(notificationDestination(n("promo_credit"))).toEqual({ to: "/wallet" });
    expect(notificationDestination(n("verification_submitted"))).toEqual({
      to: "/admin/verifications",
    });
    expect(notificationDestination(n("driver_verification"))).toEqual({ to: "/profile" });
    expect(notificationDestination(n("new_message", "j1"))).toEqual({
      to: "/chat/$jobId",
      params: { jobId: "j1" },
    });
    expect(notificationDestination(n("bid_accepted", "j1"))).toEqual({
      to: "/jobs/$id",
      params: { id: "j1" },
    });
    expect(notificationDestination(n("admin_signin"))).toBeNull();
  });
});

describe("driver notifications say what to do next", () => {
  const v = (title: string) => ({
    id: "1",
    type: "driver_verification",
    title,
    job_id: null,
    created_at: "",
  });
  it("approval opens Find Jobs, rejection opens the fix page, pending opens the profile", () => {
    expect(notificationDestination(v("You're verified!"))).toEqual({ to: "/home" });
    expect(notificationDestination(v("Verification rejected"))).toEqual({ to: "/become-driver" });
    expect(notificationDestination(v("Verification pending"))).toEqual({ to: "/profile" });
    expect(notificationDestination(v("Driver documents changed — re-review needed"))).toEqual({
      to: "/admin/verifications",
    });
  });
  it("adds a next-step line", () => {
    expect(notificationHint(v("You're verified!"))).toMatch(/Find Jobs/);
    expect(notificationHint(v("Verification rejected"))).toMatch(/resubmit/);
    expect(notificationHint({ type: "repeat_customer", title: "x" })).toMatch(/not assigned/);
    expect(notificationHint({ type: "bid_accepted", title: "x" })).toBeNull();
  });
});

describe("notification list reliability", () => {
  const row = (
    id: string,
    extra: Partial<{ read: boolean; archived_at: string | null; created_at: string }> = {},
  ) => ({
    id,
    type: "bid_accepted",
    job_id: null,
    read: false,
    archived_at: null as string | null,
    created_at: "2026-11-06T10:00:00Z",
    ...extra,
  });

  it("only a missing column allows the plain-list fallback", () => {
    expect(
      isMissingArchiveColumn({
        code: "42703",
        message: "column notifications.archived_at does not exist",
      }),
    ).toBe(true);
    expect(
      isMissingArchiveColumn({
        code: "PGRST204",
        message: "Could not find the 'archived_at' column",
      }),
    ).toBe(true);
    expect(
      isMissingArchiveColumn({
        code: "57014",
        message: "canceling statement due to statement timeout",
      }),
    ).toBe(false);
    expect(isMissingArchiveColumn({ message: "Failed to fetch" })).toBe(false);
    expect(isMissingArchiveColumn(null)).toBe(false);
  });

  it("archived rows are never shown or counted, even if a query returned them", () => {
    const items = [
      row("a"),
      row("b", { archived_at: "2026-11-06T11:00:00Z" }),
      row("c", { read: true }),
    ];
    expect(visibleNotifications(items).map((i) => i.id)).toEqual(["a", "c"]);
    expect(unreadCount(items)).toBe(1);
  });

  it("a redelivered realtime INSERT is not added or announced twice", () => {
    const first = mergeInserted([row("x")], row("n1"));
    expect(first.isNew).toBe(true);
    expect(first.items.map((i) => i.id)).toEqual(["n1", "x"]);
    const again = mergeInserted(first.items, row("n1"));
    expect(again.isNew).toBe(false);
    expect(again.items).toBe(first.items);
    expect(unreadCount(again.items)).toBe(2);
  });

  it("an UPDATE changes a listed row, ignores an unknown archived one, and restores an unarchived one", () => {
    const list = [row("a"), row("b")];
    expect(applyUpdated(list, row("a", { read: true })).find((i) => i.id === "a")?.read).toBe(true);
    expect(applyUpdated(list, row("z", { archived_at: "2026-11-06T11:00:00Z" }))).toBe(list);
    const restored = applyUpdated(list, row("z", { created_at: "2026-11-06T12:00:00Z" }));
    expect(restored.map((i) => i.id)).toEqual(["z", "a", "b"]);
  });

  it("the bell wires the guard: seen ids gate the sound and toast", () => {
    const src = readFileSync("src/components/NotificationsBell.tsx", "utf8");
    expect(src).toMatch(/seen\.current\.has\(n\.id\)/);
    expect(src).toMatch(/isMissingArchiveColumn\(res\.error\)/);
  });
});
