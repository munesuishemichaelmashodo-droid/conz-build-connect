import { describe, expect, it } from "vitest";
import { buildAttention, type AttentionInput } from "@/lib/admin-attention";

const now = Date.parse("2026-10-22T12:00:00Z");
const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
const base: AttentionInput = {
  now,
  isSuper: true,
  aal: "aal1",
  activeJobs: [],
  initiatedPayments: [],
  pendingTopups: 0,
  latestRecon: { ran_at: ago(12), ok: true },
};

describe("buildAttention", () => {
  it("is empty when nothing is wrong", () => {
    expect(buildAttention(base)).toEqual([]);
  });

  it("flags active jobs with no update for 2+ days, oldest first", () => {
    const items = buildAttention({
      ...base,
      activeJobs: [
        {
          id: "a",
          status: "in_progress",
          created_at: ago(24 * 70),
          updated_at: ago(24 * 63),
          material: "river_sand",
          quantity_m3: 12,
        },
        { id: "b", status: "accepted", created_at: ago(24 * 74) },
        { id: "c", status: "in_progress", created_at: ago(5) },
        { id: "d", status: "completed", created_at: ago(24 * 90) },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("stale-jobs");
    expect(items[0].tone).toBe("critical");
    expect(items[0].jobs?.map((j) => j.id)).toEqual(["b", "a"]);
    expect(items[0].jobs?.[1].label).toBe("River sand · 12 m³");
  });

  it("uses the last update, not the creation date", () => {
    const items = buildAttention({
      ...base,
      activeJobs: [
        { id: "x", status: "in_progress", created_at: ago(24 * 30), updated_at: ago(3) },
      ],
    });
    expect(items).toEqual([]);
  });

  it("flags Paynow payments stuck at initiated for an hour or more", () => {
    const items = buildAttention({
      ...base,
      initiatedPayments: [{ created_at: ago(30 / 60) }, { created_at: ago(2) }],
    });
    expect(items.map((i) => i.key)).toEqual(["stuck-payments"]);
    expect(items[0].title).toContain("1 Paynow payment is");
  });

  it("sends a super admin without an authenticator check to set one up before approving top-ups", () => {
    expect(buildAttention({ ...base, pendingTopups: 3 })[0]).toMatchObject({
      key: "pending-topups",
      to: "/mfa",
    });
    expect(buildAttention({ ...base, pendingTopups: 3, aal: "aal2" })[0]).toMatchObject({
      to: "/admin/revenue",
    });
  });

  it("never shows super-admin-only items to a plain admin", () => {
    const items = buildAttention({
      ...base,
      isSuper: false,
      pendingTopups: 3,
      latestRecon: { ran_at: ago(100), ok: false },
    });
    expect(items).toEqual([]);
  });

  it("reports failed, stale and missing reconciliation", () => {
    expect(buildAttention({ ...base, latestRecon: { ran_at: ago(2), ok: false } })[0].key).toBe(
      "recon-failed",
    );
    expect(buildAttention({ ...base, latestRecon: { ran_at: ago(40), ok: true } })[0].key).toBe(
      "recon-stale",
    );
    expect(buildAttention({ ...base, latestRecon: null })[0].key).toBe("recon-missing");
  });

  it("lists critical items before warnings", () => {
    const items = buildAttention({
      ...base,
      initiatedPayments: [{ created_at: ago(3) }],
      activeJobs: [{ id: "a", status: "accepted", created_at: ago(24 * 5) }],
    });
    expect(items.map((i) => i.tone)).toEqual(["critical", "warn"]);
  });
});
