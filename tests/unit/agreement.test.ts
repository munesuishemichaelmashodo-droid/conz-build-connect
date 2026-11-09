import { describe, expect, it } from "vitest";
import {
  agreementView,
  carriedDeposit,
  currentAgreement,
  payLine,
  type JobAgreement,
} from "@/lib/agreement";

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
  it("keeps the deposit of the newest version that was not declined", () => {
    expect(
      carriedDeposit([
        { status: "declined", deposit_amount: 50 },
        { status: "superseded", deposit_amount: 20 },
      ]),
    ).toBe(20);
  });
  it("is zero with no versions or no deposit", () => {
    expect(carriedDeposit(null)).toBe(0);
    expect(carriedDeposit([])).toBe(0);
    expect(carriedDeposit([{ status: "proposed", deposit_amount: 0 }])).toBe(0);
  });
});
