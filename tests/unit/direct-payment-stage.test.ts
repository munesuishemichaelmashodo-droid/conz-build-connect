import { describe, expect, it } from "vitest";
import {
  amountsDisagree,
  directPaymentStage,
  directPaymentStageLabel,
  parseCustomerRecord,
  type DirectPaymentConfirmation,
} from "@/lib/direct-payment";

const driver: DirectPaymentConfirmation = {
  method: "ecocash",
  amount: 400,
  agreedAmount: 400,
  reference: null,
  confirmedAt: "2026-11-26T10:00:00Z",
};
const reported = parseCustomerRecord({
  method: "ecocash",
  amount: "400",
  reported_at: "2026-11-26T09:00:00Z",
});
const acked = parseCustomerRecord({ acknowledged_at: "2026-11-26T11:00:00Z" });

describe("direct payment stages (0178)", () => {
  it("follows the parties' statements in order", () => {
    expect(directPaymentStage(null, null, "none")).toBe("not_recorded");
    expect(directPaymentStage(null, reported, "none")).toBe("customer_says_paid");
    expect(directPaymentStage(driver, reported, "none")).toBe("driver_confirmed");
    expect(directPaymentStage(driver, acked, "none")).toBe("customer_acknowledged");
  });
  it("an open dispute wins; a resolved one does not", () => {
    expect(directPaymentStage(driver, acked, "open")).toBe("disputed");
    expect(directPaymentStage(driver, acked, "resolved")).toBe("customer_acknowledged");
  });
  it("an acknowledgement without a driver confirmation is not 'agreed'", () => {
    expect(directPaymentStage(null, acked, "none")).toBe("not_recorded");
  });
  it("labels never say verified or guaranteed", () => {
    for (const s of [
      "not_recorded",
      "customer_says_paid",
      "driver_confirmed",
      "customer_acknowledged",
      "disputed",
    ] as const) {
      expect(directPaymentStageLabel(s)).not.toMatch(/verif|guarant|protect/i);
    }
  });
  it("flags amounts that differ from the agreed price or from each other", () => {
    expect(amountsDisagree(400, driver, reported)).toBe(false);
    expect(amountsDisagree(400, { ...driver, amount: 350 }, reported)).toBe(true);
    expect(
      amountsDisagree(
        400,
        null,
        parseCustomerRecord({ method: "cash", amount: 300, reported_at: "x" }),
      ),
    ).toBe(true);
  });
  it("parses a missing or partial record safely", () => {
    expect(parseCustomerRecord(null)).toBeNull();
    expect(parseCustomerRecord({ method: "crypto", amount: "abc" })).toEqual({
      method: null,
      amount: null,
      reference: null,
      reportedAt: null,
      acknowledgedAt: null,
    });
  });
});
