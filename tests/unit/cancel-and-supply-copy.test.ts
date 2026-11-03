import { describe, expect, it } from "vitest";
import { cancelPolicyText, customerCanCancel } from "@/lib/cancel-policy";
import { supplyActionCopy } from "@/lib/stockStatus";

describe("customer cancellation matches cancel_job", () => {
  it("is offered while open or accepted", () => {
    expect(customerCanCancel("open")).toBe(true);
    expect(customerCanCancel("accepted")).toBe(true);
  });
  it("is not offered once the trip is in progress or the job is closed", () => {
    for (const s of ["in_progress", "completed", "cancelled", null, undefined]) {
      expect(customerCanCancel(s)).toBe(false);
    }
  });
  it("never promises a fee; names the strike after acceptance", () => {
    expect(cancelPolicyText("open")).toMatch(/free/);
    expect(cancelPolicyText("accepted")).toMatch(/strike/);
    for (const s of ["open", "accepted"]) expect(cancelPolicyText(s)).not.toMatch(/fee/i);
  });
});

describe("supply confirmation copy for the people who confirm", () => {
  it("tells the driver to check with the supplier and confirm", () => {
    expect(supplyActionCopy("driver")).toMatch(/Check with the supplier/);
    expect(supplyActionCopy("driver")).toMatch(/Confirm/);
    expect(supplyActionCopy("driver")).not.toMatch(/\bwe confirm\b/i);
  });
  it("tells an admin to confirm only after hearing from the driver or supplier", () => {
    expect(supplyActionCopy("admin")).toMatch(/driver or the supplier/);
  });
});
