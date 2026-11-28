import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSY_OFFER_TEXT, driverOfferError } from "@/lib/driver-offer-rules";
import { REASON_TEXT } from "@/components/admin/DispatchEligibilityPanel";

describe("driverOfferError (0195 refusals in plain words)", () => {
  it("explains a busy driver", () => {
    expect(
      driverOfferError("DRIVER_BUSY: you are on another job. Finish it before sending offers."),
    ).toBe(BUSY_OFFER_TEXT);
  });
  it("explains a commission credit shortfall, from the trigger or the older checks", () => {
    expect(driverOfferError("COMMISSION_CREDIT: your Commission Credit does not cover…")).toMatch(
      /Commission Credit does not cover/,
    );
    expect(
      driverOfferError("Insufficient wallet balance: need $10.50, have $1.00 available"),
    ).toMatch(/Top up, or offer a lower price/);
  });
  it("leaves other messages alone", () => {
    expect(driverOfferError("This job has already been assigned to another driver.")).toBeNull();
    expect(driverOfferError(undefined)).toBeNull();
  });
  it("never promises a withdrawal or cash", () => {
    expect(BUSY_OFFER_TEXT).not.toMatch(/withdraw|cash/i);
  });
});

describe("every 0195 exclusion reason has wording for admins", () => {
  const sql = readFileSync(
    "supabase/migrations/20261127160000_0195_dispatch_eligibility_busy_drivers.sql",
    "utf8",
  );
  const reasons = [...sql.matchAll(/then '([a-z_]+)' end/g)].map((m) => m[1]);
  it("covers each reason the database can return", () => {
    expect(reasons.length).toBeGreaterThan(8);
    for (const r of [...reasons, "outside_current_radius", "job_not_open"])
      expect(REASON_TEXT[r], r).toBeTruthy();
  });
});

describe("driver screens check before sending (the database refuses as well)", () => {
  const job = readFileSync("src/routes/_authenticated/jobs.$id.tsx", "utf8");
  const quick = readFileSync("src/components/redesign/useQuickAccept.ts", "utf8");
  it("the offer form is blocked while the driver is on another job", () => {
    expect(job).toMatch(/onOtherJob\s*\?\s*BUSY_OFFER_TEXT/);
  });
  it("quick accept checks for an active job before sending", () => {
    const pre = quick.slice(quick.indexOf("setBusyJobId(job.id)"), quick.indexOf('from("bids")'));
    expect(pre).toMatch(/\.in\("status", \["accepted", "in_progress"\]\)/);
    expect(pre).toMatch(/toast\.error\(BUSY_OFFER_TEXT\)/);
  });
  it("offer errors go through the plain-words mapping", () => {
    expect(job).toMatch(/driverOfferError\(error\.message\) \?\? error\.message/);
    expect(quick).toMatch(/driverOfferError\(error\.message\) \?\? error\.message/);
  });
});

describe("customer side (0195)", () => {
  it("explains an offer withdrawn because the driver took another job", async () => {
    const { friendlyAcceptError } = await import("@/lib/cancel-policy");
    expect(friendlyAcceptError("Bid no longer available")).toMatch(
      /driver took another job or withdrew it/,
    );
  });
});
