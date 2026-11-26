import { describe, expect, it } from "vitest";
import {
  agreementView,
  carriedDeposit,
  currentAgreement,
  payLine,
  paymentPlanLabel,
  type JobAgreement,
} from "@/lib/agreement";

describe("payment terms (0179)", () => {
  const row: JobAgreement = {
    id: "a",
    job_id: "j",
    version: 1,
    proposed_by: "driver",
    fare: 100,
    payment_method: "ecocash",
    payment_timing: "on_delivery",
    deposit_amount: 0,
    pickup_window: null,
    delivery_window: null,
    inclusions: null,
    exclusions: null,
    status: "proposed",
    customer_accepted_at: null,
    driver_accepted_at: "t",
    created_at: "t",
  };
  it("names the four plans", () => {
    expect(paymentPlanLabel(row)).toBe("Payment after delivery");
    expect(paymentPlanLabel({ ...row, payment_timing: "on_pickup" })).toBe("No deposit");
    expect(paymentPlanLabel({ ...row, deposit_amount: 20 })).toBe("Deposit, then the balance");
    expect(paymentPlanLabel({ ...row, deposit_amount: 100 })).toBe("Full advance payment");
  });
  it("states the deposit timing and the balance; a full advance says so", () => {
    expect(payLine({ ...row, deposit_amount: 20, deposit_due: "before_pickup" })).toContain(
      "$20.00 deposit paid to the driver before pickup (balance $80.00)",
    );
    expect(payLine({ ...row, deposit_amount: 100, deposit_due: "on_agreement" })).toMatch(
      /in full in advance, directly to the driver/,
    );
  });
});

const base: JobAgreement = {
  id: "a",
  job_id: "j",
  version: 1,
  proposed_by: "driver",
  fare: 100,
  payment_method: "ecocash",
  payment_timing: "on_delivery",
  deposit_amount: 0,
  pickup_window: null,
  delivery_window: null,
  inclusions: null,
  exclusions: null,
  status: "proposed",
  customer_accepted_at: null,
  driver_accepted_at: "t",
  created_at: "t",
};

describe("agreement view", () => {
  it("shows nothing before anyone proposes", () => {
    expect(currentAgreement([])).toBeNull();
    expect(agreementView(null, "u")).toBe("none");
  });
  it("prefers the open proposal over an older accepted version", () => {
    const rows = [
      { ...base, version: 1, status: "accepted" as const },
      { ...base, version: 2 },
    ];
    expect(currentAgreement(rows)?.version).toBe(2);
  });
  it("falls back to the last accepted version and ignores superseded or declined ones", () => {
    const rows = [
      { ...base, version: 1, status: "accepted" as const },
      { ...base, version: 2, status: "declined" as const },
    ];
    expect(currentAgreement(rows)?.version).toBe(1);
    expect(currentAgreement([{ ...base, status: "superseded" }])).toBeNull();
  });
  it("tells the proposer to wait and the other person to answer", () => {
    expect(agreementView(base, "driver")).toBe("waiting_for_other");
    expect(agreementView(base, "customer")).toBe("needs_my_answer");
    expect(agreementView({ ...base, status: "accepted" }, "customer")).toBe("agreed");
  });
});

describe("payLine", () => {
  it("says the fare goes straight to the driver, and a deposit is paid to the driver", () => {
    const text = payLine({ ...base, deposit_amount: 20 });
    expect(text).toContain("paid directly to the driver");
    expect(text).toContain("$20.00 deposit paid to the driver");
    expect(text).not.toMatch(/escrow|wallet|we hold/i);
  });
  it("omits the deposit when there is none", () => {
    expect(payLine(base)).not.toMatch(/deposit/);
  });
});

describe("carriedDeposit", () => {
  it("keeps the deposit of the newest version still proposed or accepted", () => {
    expect(
      carriedDeposit([
        { status: "declined", deposit_amount: 50 },
        { status: "proposed", deposit_amount: 20 },
        { status: "accepted", deposit_amount: 10 },
      ]),
    ).toBe(20);
  });
  it("never carries a superseded or declined deposit (driver v1 $20 accepted, v2 $30 superseded, v3 $40 declined)", () => {
    expect(
      carriedDeposit([
        { status: "declined", deposit_amount: 40 },
        { status: "superseded", deposit_amount: 30 },
        { status: "accepted", deposit_amount: 20 },
      ]),
    ).toBe(20);
    expect(carriedDeposit([{ status: "superseded", deposit_amount: 30 }])).toBe(0);
  });
  it("is zero with no versions or no deposit", () => {
    expect(carriedDeposit(null)).toBe(0);
    expect(carriedDeposit([])).toBe(0);
    expect(carriedDeposit([{ status: "proposed", deposit_amount: 0 }])).toBe(0);
  });
});
