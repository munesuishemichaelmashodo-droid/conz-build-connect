import { describe, expect, it } from "vitest";
import {
  driverNeedsBanner,
  jobsDoneLabel,
  ratingLabel,
  verificationBanner,
} from "@/lib/driver-onboarding";
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
  it("no longer asks drivers to verify their phone by SMS", () => {
    expect(verificationBanner("pending", false)?.body).not.toMatch(/verify your phone/i);
  });
  it("explains a re-review after a truck or document change, with the reason", () => {
    const b = verificationBanner("pending", true, {
      notes:
        "Truck details changed (ABC-123). Con Z needs to check it before you can take more jobs.",
    });
    expect(b?.title).toBe("We're checking your changes");
    expect(b?.body).toContain("ABC-123");
  });
  it("warns an approved driver whose 90-day check is overdue (the database blocks bidding)", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(
      verificationBanner("verified", true, { reverifyDueAt: "2026-10-25T00:00:00Z", now })?.title,
    ).toBe("Your 90-day check is due");
    expect(
      verificationBanner("verified", true, { reverifyDueAt: "2026-11-25T00:00:00Z", now }),
    ).toBeNull();
  });
});

describe("driverNeedsBanner", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  it("is true for any driver who can't bid right now", () => {
    expect(driverNeedsBanner({ verification_status: "pending" }, now)).toBe(true);
    expect(
      driverNeedsBanner(
        { verification_status: "verified", reverify_due_at: "2026-10-01T00:00:00Z" },
        now,
      ),
    ).toBe(true);
    expect(driverNeedsBanner(null, now)).toBe(true);
  });
  it("is false for an approved driver who is in date", () => {
    expect(driverNeedsBanner({ verification_status: "verified", reverify_due_at: null }, now)).toBe(
      false,
    );
    expect(
      driverNeedsBanner(
        { verification_status: "verified", reverify_due_at: "2027-01-01T00:00:00Z" },
        now,
      ),
    ).toBe(false);
  });
});

describe("customerTrustPill", () => {
  it("only mentions escrow when escrow is switched on", () => {
    expect(customerTrustPill(true)).toMatch(/escrow/i);
    expect(customerTrustPill(false)).not.toMatch(/escrow|con z pay/i);
  });
});
