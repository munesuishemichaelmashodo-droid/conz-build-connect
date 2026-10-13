import { describe, expect, it } from "vitest";
import { DEFAULT_LAUNCH_SWITCHES, parseLaunchSwitches } from "@/lib/launch-switches";

describe("parseLaunchSwitches", () => {
  it("falls back to the restrictive MVP defaults for missing or bad data", () => {
    expect(parseLaunchSwitches(null)).toEqual(DEFAULT_LAUNCH_SWITCHES);
    expect(parseLaunchSwitches("nope")).toEqual(DEFAULT_LAUNCH_SWITCHES);
    expect(parseLaunchSwitches({ escrowEnabled: "true", maxJobBudget: -5 })).toEqual(
      DEFAULT_LAUNCH_SWITCHES,
    );
  });
  it("only a real boolean true turns a feature on", () => {
    const on = parseLaunchSwitches({
      escrowEnabled: true,
      withdrawalsEnabled: true,
      maxJobBudget: 900,
    });
    expect(on.escrowEnabled).toBe(true);
    expect(on.withdrawalsEnabled).toBe(true);
    expect(on.maxJobBudget).toBe(900);
    expect(parseLaunchSwitches({ escrowEnabled: 1 }).escrowEnabled).toBe(false);
  });
});
