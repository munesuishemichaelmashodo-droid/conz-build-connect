import { describe, expect, it } from "vitest";
import {
  advanceMode,
  clickAdvances,
  isStepDone,
  locateTimeoutMs,
  nextDisabled,
} from "../../src/lib/tour/step-logic";
import type { TourStep } from "../../src/lib/tour/types";

const base: TourStep = {
  id: "s",
  title: "t",
  description: "d",
  route: "/x",
  target: '[data-tour="a"]',
};
const dom = (present: string[]) => ({
  querySelector: (sel: string) => (present.includes(sel) ? {} : null),
});

describe("advanceMode", () => {
  it("defaults to next-only", () => expect(advanceMode(base)).toBe("next"));
  it("maps legacy interactive to click", () =>
    expect(advanceMode({ ...base, interactive: true })).toBe("click"));
  it("prefers explicit advance", () =>
    expect(advanceMode({ ...base, interactive: true, advance: "done" })).toBe("done"));
});

describe("done steps (interactive waiting)", () => {
  const step: TourStep = { ...base, advance: "done", doneWhen: '[data-ready="true"]' };
  it("is not done, and Next is blocked, until doneWhen appears", () => {
    expect(isStepDone(step, dom([]))).toBe(false);
    expect(nextDisabled(step, dom([]))).toBe(true);
  });
  it("is done and unblocked once the user has acted", () => {
    expect(isStepDone(step, dom(['[data-ready="true"]']))).toBe(true);
    expect(nextDisabled(step, dom(['[data-ready="true"]']))).toBe(false);
  });
  it("never blocks plain Next steps", () => expect(nextDisabled(base, dom([]))).toBe(false));
});

describe("click steps", () => {
  const step: TourStep = { ...base, advance: "click" };
  const el = (matches: string[]) => ({
    closest: (sel: string) => (matches.includes(sel) ? {} : null),
  });
  it("advances only for a click inside the highlighted target", () => {
    expect(clickAdvances(step, el([base.target]))).toBe(true);
    expect(clickAdvances(step, el([]))).toBe(false);
  });
  it("honours a separate clickTarget", () => {
    const s = { ...step, clickTarget: "button.go" };
    expect(clickAdvances(s, el(["button.go"]))).toBe(true);
    expect(clickAdvances(s, el([base.target]))).toBe(false);
  });
  it("ignores clicks on next-only steps and null targets", () => {
    expect(clickAdvances(base, el([base.target]))).toBe(false);
    expect(clickAdvances(step, null)).toBe(false);
  });
});

describe("locateTimeoutMs — no auto-skip while the user is acting", () => {
  it("uses the default / step timeout for ordinary steps", () => {
    expect(locateTimeoutMs(base, 2500)).toBe(2500);
    expect(locateTimeoutMs({ ...base, waitMs: 3000 }, 2500)).toBe(3000);
  });
  it("waits indefinitely for waitForUser and done steps", () => {
    expect(locateTimeoutMs({ ...base, waitForUser: true, waitMs: 100 }, 2500)).toBeNull();
    expect(locateTimeoutMs({ ...base, advance: "done", doneWhen: "x" }, 2500)).toBeNull();
  });
});
