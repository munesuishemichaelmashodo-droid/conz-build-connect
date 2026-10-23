import { describe, expect, it } from "vitest";
import {
  UNMATCHED_JOB_MINUTES,
  buildAttention,
  formatAge,
  type AttentionInput,
} from "@/lib/admin-attention";

const now = Date.parse("2026-10-23T12:00:00Z");
const minAgo = (m: number) => new Date(now - m * 60_000).toISOString();
const base: AttentionInput = {
  now,
  isSuper: false,
  aal: "aal1",
  activeJobs: [],
  initiatedPayments: [],
  pendingTopups: null,
};
const job = (id: string, minutes: number, offers = 0, bids = 0) => ({
  id,
  created_at: minAgo(minutes),
  material: "river_sand",
  quantity_m3: 12,
  delivery_address: "Harward Road, Belvedere, Harare, Zimbabwe",
  dispatchOffers: offers,
  bids,
});

describe("unmatched open jobs", () => {
  it("waits 10 minutes before flagging a job", () => {
    expect(UNMATCHED_JOB_MINUTES).toBe(10);
    expect(buildAttention({ ...base, openJobs: [job("a", 9)] })).toEqual([]);
  });

  it("flags an open job no driver was offered and no driver bid on, as urgent", () => {
    const items = buildAttention({ ...base, openJobs: [job("a", 25)] });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("unmatched-jobs");
    expect(items[0].tone).toBe("critical");
    expect(items[0].title).toBe("1 open job has reached no driver");
    expect(items[0].jobs?.[0]).toMatchObject({ id: "a", ageLabel: "25 min" });
    expect(items[0].jobs?.[0].label).toBe("River sand · 12 m³ · Belvedere, Harare");
  });

  it("ignores jobs that were offered to a driver or have a bid", () => {
    const items = buildAttention({
      ...base,
      openJobs: [job("offered", 60, 1, 0), job("bid", 60, 0, 2)],
    });
    expect(items).toEqual([]);
  });

  it("lists the oldest first, at most five, and counts them all", () => {
    const items = buildAttention({
      ...base,
      openJobs: [15, 400, 30, 90, 3000, 20, 11].map((m, i) => job(`j${i}`, m)),
    });
    expect(items[0].title).toBe("7 open jobs have reached no driver");
    expect(items[0].jobs?.map((j) => j.ageLabel)).toEqual([
      "2 days",
      "6 h",
      "1 h",
      "30 min",
      "20 min",
    ]);
  });

  it("is shown to plain admins as well as super admins", () => {
    expect(buildAttention({ ...base, isSuper: false, openJobs: [job("a", 30)] })).toHaveLength(1);
  });

  it("works when the open-jobs check was not loaded", () => {
    expect(buildAttention({ ...base, openJobs: undefined })).toEqual([]);
  });
});

describe("job place", () => {
  const label = (delivery_address: string | null) =>
    buildAttention({ ...base, openJobs: [{ ...job("a", 30), delivery_address }] })[0].jobs?.[0]
      .label;

  it("shows suburb and city, without the street or the country", () => {
    expect(label("Mazowe, Mashonaland Central, Zimbabwe")).toBe(
      "River sand · 12 m³ · Mazowe, Mashonaland Central",
    );
    expect(label("Harare")).toBe("River sand · 12 m³ · Harare");
  });

  it("leaves the place out when there is no address", () => {
    expect(label(null)).toBe("River sand · 12 m³");
  });
});

describe("formatAge", () => {
  it("uses minutes, then hours, then days", () => {
    expect(formatAge(25 * 60_000)).toBe("25 min");
    expect(formatAge(59 * 60_000)).toBe("59 min");
    expect(formatAge(60 * 60_000)).toBe("1 h");
    expect(formatAge(47 * 3_600_000)).toBe("1 day");
    expect(formatAge(50 * 3_600_000)).toBe("2 days");
  });
});
