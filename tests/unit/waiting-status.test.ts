import { describe, expect, it } from "vitest";
import { closesText, postedAgoText } from "@/lib/waiting-status";

const now = Date.parse("2026-11-08T12:00:00Z");
describe("postedAgoText", () => {
  it("says how long ago in plain units", () => {
    expect(postedAgoText("2026-11-08T11:59:40Z", now)).toBe("Posted just now");
    expect(postedAgoText("2026-11-08T11:59:00Z", now)).toBe("Posted 1 minute ago");
    expect(postedAgoText("2026-11-08T11:30:00Z", now)).toBe("Posted 30 minutes ago");
    expect(postedAgoText("2026-11-08T09:00:00Z", now)).toBe("Posted 3 hours ago");
    expect(postedAgoText("2026-11-06T12:00:00Z", now)).toBe("Posted 2 days ago");
  });
  it("says nothing it cannot know", () => {
    expect(postedAgoText(null, now)).toBeNull();
    expect(postedAgoText("garbage", now)).toBeNull();
  });
});
describe("closesText", () => {
  it("names the real close time and never promises an offer", () => {
    const t = closesText("2026-11-09T12:00:00Z", now)!;
    expect(t).toMatch(/^Stays open until /);
    expect(t).toMatch(/post it again/);
    expect(t).not.toMatch(/minutes|soon|guarantee/i);
  });
  it("handles a missing or past close time", () => {
    expect(closesText(null, now)).toBeNull();
    expect(closesText("2026-11-08T11:00:00Z", now)).toMatch(/about to close/);
  });
});
