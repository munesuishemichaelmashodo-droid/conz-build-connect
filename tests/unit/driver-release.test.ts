import { describe, expect, it } from "vitest";
import {
  DRIVER_RELEASE_POLICY_TEXT,
  driverCanRelease,
  friendlyAcceptError,
} from "@/lib/cancel-policy";

describe("driverCanRelease (mirrors cancel_job / 0145)", () => {
  it("lets the assigned driver release an accepted direct-pay job before pickup", () => {
    expect(driverCanRelease("accepted", false, "direct")).toBe(true);
  });
  it("not once the load has been collected", () => {
    expect(driverCanRelease("accepted", true, "direct")).toBe(false);
  });
  it("not while the trip is in progress (that needs a dispute) or after it ended", () => {
    for (const s of ["open", "in_progress", "completed", "cancelled", null, undefined]) {
      expect(driverCanRelease(s, false, "direct")).toBe(false);
    }
  });
  it("not for escrow jobs (they keep the refund flow)", () => {
    expect(driverCanRelease("accepted", false, "escrow")).toBe(false);
    expect(driverCanRelease("accepted", false, null)).toBe(false);
  });
  it("tells the driver the truth about the consequences", () => {
    expect(DRIVER_RELEASE_POLICY_TEXT).toMatch(/other drivers/i);
    expect(DRIVER_RELEASE_POLICY_TEXT).toMatch(/cancellation on your/i);
  });
});

describe("friendlyAcceptError", () => {
  it("turns the busy-driver refusal into a plain instruction for the customer", () => {
    const msg =
      "DRIVER_BUSY: this driver is already on another job. Choose another offer, or wait until they finish their current job.";
    expect(friendlyAcceptError(msg)).toBe(
      "This driver has just taken another job. Please choose another offer.",
    );
  });
  it("leaves every other error to the caller", () => {
    expect(friendlyAcceptError("Job not open")).toBeNull();
    expect(friendlyAcceptError(undefined)).toBeNull();
  });
});
