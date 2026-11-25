import { describe, expect, it } from "vitest";
import {
  driverEarningsNote,
  normalisePaymentMethod,
  paymentMethodLabel,
  receiptPaymentMethod,
} from "@/lib/payment-method-copy";

describe("payment method wording", () => {
  it("an online-paid (provider) job is never described as paid directly to the driver", () => {
    expect(paymentMethodLabel("provider")).toBe("Online through Con Z");
    expect(receiptPaymentMethod("provider")).toBe("Paid online through Con Z");
    const note = driverEarningsNote("provider", false);
    expect(note).toContain("owed to you");
    expect(note).not.toMatch(/directly|comes off your wallet/i);
  });

  it("never promises protection, escrow or a payout date for provider-paid jobs", () => {
    for (const t of [
      paymentMethodLabel("provider"),
      receiptPaymentMethod("provider"),
      driverEarningsNote("provider", true),
    ]) {
      expect(t).not.toMatch(/escrow|guarantee|protected|within \d|paid out (today|tomorrow)/i);
    }
  });

  it("direct and escrow wording is unchanged", () => {
    expect(paymentMethodLabel("direct")).toBe("Directly to driver");
    expect(receiptPaymentMethod("direct")).toBe("Paid directly to driver");
    expect(driverEarningsNote("direct", false)).toBe(
      "Paid to you directly by the customer. The Con Z fee comes off your wallet balance.",
    );
    expect(paymentMethodLabel("escrow")).toBe("Con Z Pay");
    expect(receiptPaymentMethod("escrow")).toBe("Con Z Pay (held & released on confirmation)");
    expect(driverEarningsNote("escrow", true)).toMatch(
      /^Released from Con Z Pay into your wallet\. Withdraw/,
    );
    expect(driverEarningsNote("escrow", false)).toMatch(/Withdrawals are paused/);
  });

  it("missing or unknown methods fall back to direct (the only method before 0171)", () => {
    expect(normalisePaymentMethod(undefined)).toBe("direct");
    expect(normalisePaymentMethod("cash")).toBe("direct");
    expect(paymentMethodLabel(null)).toBe("Directly to driver");
  });
});
