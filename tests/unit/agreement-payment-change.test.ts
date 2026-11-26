import { describe, expect, it } from "vitest";
import { paymentDetailChanges, type JobAgreement } from "@/lib/agreement";

const base = {
  job_id: "j",
  fare: 400,
  payment_method: "ecocash",
  payment_channel: "ecocash",
  payment_timing: "on_delivery",
  deposit_amount: 0,
  recipient_name: "T Driver",
  recipient_account: "0771234567",
  payment_instructions: "EcoCash, reference = job number",
} as unknown as JobAgreement;
const v = (version: number, status: string, extra: Partial<JobAgreement> = {}) =>
  ({ ...base, id: `a${version}`, version, status, proposed_by: "drv", ...extra }) as JobAgreement;

describe("paymentDetailChanges", () => {
  it("is empty when nothing was accepted before", () => {
    expect(paymentDetailChanges([v(1, "proposed")])).toEqual([]);
  });
  it("is empty when there is no pending proposal", () => {
    expect(paymentDetailChanges([v(1, "accepted")])).toEqual([]);
  });
  it("is empty when only timing changes", () => {
    expect(
      paymentDetailChanges([v(1, "accepted"), v(2, "proposed", { payment_timing: "on_pickup" })]),
    ).toEqual([]);
  });
  it("flags a new account number", () => {
    expect(
      paymentDetailChanges([
        v(1, "accepted"),
        v(2, "proposed", { recipient_account: "0712345678" }),
      ]),
    ).toEqual(["the number or account to pay"]);
  });
  it("flags a new recipient, instructions and method together", () => {
    expect(
      paymentDetailChanges([
        v(1, "accepted"),
        v(2, "proposed", {
          recipient_name: "Someone Else",
          payment_instructions: "pay my friend",
          payment_method: "other",
          payment_channel: "innbucks",
        }),
      ]),
    ).toEqual(["who to pay", "the payment instructions", "the payment method"]);
  });
  it("ignores surrounding spaces", () => {
    expect(
      paymentDetailChanges([
        v(1, "accepted"),
        v(2, "proposed", { recipient_account: " 0771234567 " }),
      ]),
    ).toEqual([]);
  });
  it("compares with the latest accepted version, not a superseded one", () => {
    expect(
      paymentDetailChanges([
        v(1, "superseded", { recipient_account: "0000" }),
        v(2, "accepted"),
        v(3, "proposed"),
      ]),
    ).toEqual([]);
  });
});
