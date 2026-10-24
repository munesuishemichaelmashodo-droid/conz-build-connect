import { describe, expect, it } from "vitest";
import { jobsDoneLabel, ratingLabel, verificationBanner } from "@/lib/driver-onboarding";
import { customerTrustPill } from "@/lib/launch-switches";

describe("ratingLabel", () => {
  it("never shows a 0.0 star for a driver nobody has rated", () => {
    expect(ratingLabel(0, 0)).toBe("No ratings yet");
    expect(ratingLabel(null, null)).toBe("No ratings yet");
  });
  it("shows the average and how many ratings it is based on", () => {
    expect(ratingLabel(4.66, 23)).toBe("4.7 (23)");
  });
});

describe("jobsDoneLabel", () => {
  it("uses the singular for one job", () => {
    expect(jobsDoneLabel(1)).toBe("1 job done");
    expect(jobsDoneLabel(0)).toBe("0 jobs done");
    expect(jobsDoneLabel(31)).toBe("31 jobs done");
  });
});

describe("verificationBanner", () => {
  it("is hidden once the driver is approved", () => {
    expect(verificationBanner("verified", true)).toBeNull();
  });
  it("follows the real application state", () => {
    expect(verificationBanner("pending", false)?.title).toBe("Finish your driver sign-up");
    expect(verificationBanner("pending", true)?.title).toBe("Your application is under review");
    expect(verificationBanner("rejected", true)?.title).toBe("Your application needs changes");
    expect(verificationBanner(null, false)?.title).toBe("Finish your driver sign-up");
  });
});

describe("customerTrustPill", () => {
  it("only mentions escrow when escrow is switched on", () => {
    expect(customerTrustPill(true)).toMatch(/escrow/i);
    expect(customerTrustPill(false)).not.toMatch(/escrow|con z pay/i);
  });
});
