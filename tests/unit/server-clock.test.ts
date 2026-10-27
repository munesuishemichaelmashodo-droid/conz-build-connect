import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ handler: () => () => Promise.resolve({ now: 0 }) }),
}));
import { clockOffset } from "@/lib/server-clock";

describe("clockOffset", () => {
  it("finds a phone running 10 minutes fast", () => {
    // phone sent at 1_000_600_000 (its clock), server says 1_000_000_250, reply after 500 ms
    expect(clockOffset(1_000_600_000, 1_000_000_250, 1_000_600_500)).toBe(-600_000);
  });
  it("finds a phone running slow", () => {
    expect(clockOffset(1_000_000_000, 1_000_120_100, 1_000_000_200)).toBe(120_000);
  });
  it("ignores drift under 5 seconds", () => {
    expect(clockOffset(1_000_000_000, 1_000_002_000, 1_000_000_200)).toBe(0);
  });
  it("doesn't trust a slow or impossible round trip", () => {
    expect(clockOffset(0, 600_000, 20_000)).toBeNull();
    expect(clockOffset(10, 600_000, 5)).toBeNull();
    expect(clockOffset(0, Number.NaN, 100)).toBeNull();
  });
});
