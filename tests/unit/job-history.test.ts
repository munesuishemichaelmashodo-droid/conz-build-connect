import { describe, expect, it } from "vitest";
import { filterHistory, isRecent, splitHistory, type HistoryRow } from "@/lib/job-history";

const row = (o: Partial<HistoryRow>): HistoryRow => ({
  id: "j1",
  status: "completed",
  material: "river_sand",
  custom_material: null,
  quantity_m3: 12,
  final_price: 200,
  net_earned: 186,
  delivery_address: "Belvedere, Harare",
  completed_at: "2026-11-01T10:00:00Z",
  cancelled_at: null,
  cancellation_reason: null,
  customer_name: "A. Moyo",
  ...o,
});
const now = new Date("2026-11-03T10:00:00Z");

describe("driver job history", () => {
  it("keeps 30 days as recent and the rest as archived, never dropping a job", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", completed_at: "2026-09-01T10:00:00Z" }),
      row({
        id: "c",
        completed_at: null,
        cancelled_at: "2026-10-20T00:00:00Z",
        status: "cancelled",
      }),
    ];
    const { recent, archived } = splitHistory(rows, now);
    expect(recent.map((r) => r.id)).toEqual(["a", "c"]);
    expect(archived.map((r) => r.id)).toEqual(["b"]);
    expect(recent.length + archived.length).toBe(rows.length);
  });

  it("treats exactly 30 days as still recent", () => {
    expect(isRecent({ completed_at: "2026-10-04T10:00:00Z", cancelled_at: null }, now)).toBe(true);
    expect(isRecent({ completed_at: "2026-10-04T09:59:00Z", cancelled_at: null }, now)).toBe(false);
  });

  it("filters by status and searches material, area, customer and reason", () => {
    const rows = [
      row({ id: "a" }),
      row({
        id: "b",
        status: "cancelled",
        completed_at: null,
        cancelled_at: "2026-11-02T00:00:00Z",
        cancellation_reason: "no access",
        material: "gravel",
      }),
    ];
    expect(filterHistory(rows, "cancelled", "").map((r) => r.id)).toEqual(["b"]);
    expect(filterHistory(rows, "all", "river sand").map((r) => r.id)).toEqual(["a"]);
    expect(filterHistory(rows, "all", "belvedere").length).toBe(2);
    expect(filterHistory(rows, "all", "no access").map((r) => r.id)).toEqual(["b"]);
    expect(filterHistory(rows, "all", "moyo").length).toBe(2);
  });
});
