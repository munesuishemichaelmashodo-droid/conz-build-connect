import { describe, expect, it } from "vitest";
import { buildAttention, type AttentionInput } from "@/lib/admin-attention";

const now = Date.parse("2026-10-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const base: AttentionInput = {
  now,
  isSuper: false,
  aal: "aal1",
  activeJobs: [],
  initiatedPayments: [],
  pendingTopups: null,
};
const row = (job_id: string, status: string, h: number, over: Record<string, unknown> = {}) => ({
  job_id,
  status: status as "ok" | "far" | "no_location" | "no_expected_point",
  distance_m: status === "far" ? 6100 : null,
  loaded_at_name: null,
  checked_at: hoursAgo(h),
  material: "river_sand",
  quantity_m3: 12,
  ...over,
});

describe("pickup checks in Needs attention", () => {
  it("lists far, no-location and unnamed driver-arranged pickups from the last 14 days", () => {
    const items = buildAttention({
      ...base,
      pickupChecks: [
        row("far", "far", 3),
        row("nogps", "no_location", 30),
        row("open", "no_expected_point", 50),
        row("named", "no_expected_point", 5, { loaded_at_name: "Mazowe pit" }),
        row("fine", "ok", 2),
        row("old", "far", 24 * 15),
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("pickup-checks");
    expect(items[0].tone).toBe("warn");
    expect(items[0].title).toBe("3 pickups need a look");
    expect(items[0].jobs?.map((j) => j.id)).toEqual(["far", "nogps", "open"]);
    expect(items[0].jobs?.[0].label).toBe("River sand · 12 m³ · 6.1 km from supplier");
    expect(items[0].jobs?.[1].label).toBe("River sand · 12 m³ · photo has no location");
    expect(items[0].jobs?.[2].label).toBe("River sand · 12 m³ · source not named");
  });

  it("is absent when nothing needs a look, or the checks were not loaded", () => {
    expect(buildAttention({ ...base, pickupChecks: [row("fine", "ok", 1)] })).toEqual([]);
    expect(buildAttention({ ...base, pickupChecks: undefined })).toEqual([]);
  });
});
