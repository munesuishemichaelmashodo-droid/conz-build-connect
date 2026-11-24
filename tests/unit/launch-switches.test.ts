import { describe, expect, it } from "vitest";
import { DEFAULT_LAUNCH_SWITCHES, parseLaunchSwitches } from "@/lib/launch-switches";

describe("parseLaunchSwitches", () => {
  it("falls back to the restrictive MVP defaults for missing or bad data", () => {
    expect(parseLaunchSwitches(null)).toEqual(DEFAULT_LAUNCH_SWITCHES);
    expect(parseLaunchSwitches("nope")).toEqual(DEFAULT_LAUNCH_SWITCHES);
    expect(parseLaunchSwitches({ escrowEnabled: "true", maxWalletBalance: -5 })).toEqual(
      DEFAULT_LAUNCH_SWITCHES,
    );
  });
  it("only a real boolean true turns a feature on", () => {
    const on = parseLaunchSwitches({
      escrowEnabled: true,
      withdrawalsEnabled: true,
      maxWalletBalance: 120,
    });
    expect(on.escrowEnabled).toBe(true);
    expect(on.withdrawalsEnabled).toBe(true);
    expect(on.maxWalletBalance).toBe(120);
    expect("maxJobBudget" in on).toBe(false); // 0172: no job ceiling
    expect(parseLaunchSwitches({ escrowEnabled: 1 }).escrowEnabled).toBe(false);
  });
});
