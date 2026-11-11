import { describe, expect, it } from "vitest";
import { splitPastJobs } from "@/lib/past-jobs";

const now = Date.parse("2026-11-11T12:00:00Z");
const day = 86_400_000;
const at = (d: number) => new Date(now - d * day).toISOString();

describe("splitPastJobs", () => {
  it("keeps jobs from the last 30 days and tucks older ones away", () => {
    const { recent, older } = splitPastJobs(
      [
        { id: 1, created_at: at(2) },
        { id: 2, created_at: at(29) },
        { id: 3, created_at: at(31) },
      ],
      now,
    );
    expect(recent.map((j) => j.id)).toEqual([1, 2]);
    expect(older.map((j) => j.id)).toEqual([3]);
  });
  it("uses the last update time when there is one", () => {
    const { recent } = splitPastJobs([{ id: 1, created_at: at(90), updated_at: at(3) }], now);
    expect(recent).toHaveLength(1);
  });
  it("never hides a job whose date cannot be read", () => {
    const { recent } = splitPastJobs([{ id: 1, created_at: "garbage" }], now);
    expect(recent).toHaveLength(1);
  });
});
