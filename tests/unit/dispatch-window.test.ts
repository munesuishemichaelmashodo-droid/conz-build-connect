import { describe, expect, it } from "vitest";
import {
  countdownColor,
  formatRemaining,
  offerFootnote,
  offerWindowMs,
} from "@/lib/dispatch-window";

describe("offerWindowMs", () => {
  it("uses the server's own timestamps", () => {
    expect(
      offerWindowMs({ offered_at: "2026-11-07T10:00:00Z", expires_at: "2026-11-07T10:05:00Z" }),
    ).toBe(300_000);
    expect(
      offerWindowMs({ offered_at: "2026-11-07T10:00:00Z", expires_at: "2026-11-07T10:01:00Z" }),
    ).toBe(60_000);
  });
  it("falls back to 60 s when timestamps are missing or inverted", () => {
    expect(offerWindowMs({ expires_at: "2026-11-07T10:00:00Z" })).toBe(60_000);
    expect(
      offerWindowMs({ offered_at: "2026-11-07T10:05:00Z", expires_at: "2026-11-07T10:00:00Z" }),
    ).toBe(60_000);
  });
});

describe("formatRemaining", () => {
  it("shows seconds under a minute and m:ss above", () => {
    expect(formatRemaining(45_000)).toBe("45");
    expect(formatRemaining(272_000)).toBe("4:32");
    expect(formatRemaining(60_000)).toBe("1:00");
    expect(formatRemaining(-5)).toBe("0");
  });
});

describe("countdownColor", () => {
  it("is proportional to the window, not absolute seconds", () => {
    expect(countdownColor(290_000, 300_000)).toBe("#22c55e");
    expect(countdownColor(10_000, 300_000)).toBe("#ef4444");
    expect(countdownColor(30_000, 60_000)).toBe("#84cc16");
  });
});

describe("offerFootnote", () => {
  it("does not promise 10 seconds", () => {
    expect(offerFootnote(60_000)).not.toMatch(/10 seconds/);
    expect(offerFootnote(300_000)).toMatch(/few minutes/);
  });
  it("says the customer chooses and never that the job is taken (0154)", () => {
    for (const ms of [60_000, 300_000]) {
      expect(offerFootnote(ms)).toMatch(/customer .*chooses/);
      expect(offerFootnote(ms)).not.toMatch(/accept|assigned|you.ve got/i);
    }
  });
});
