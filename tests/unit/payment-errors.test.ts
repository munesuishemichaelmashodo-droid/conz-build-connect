import { describe, expect, it } from "vitest";
import {
  GENERIC_PAYMENT_ERROR,
  NETWORK_ERROR_MESSAGE,
  friendlyPaymentError,
  topupAmountError,
} from "@/lib/paymentErrors";

describe("friendlyPaymentError", () => {
  it("maps transport failures to a check-before-retry message", () => {
    for (const raw of [
      "Failed to fetch",
      new TypeError("Failed to fetch"),
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      { message: "fetch failed" },
    ]) {
      expect(friendlyPaymentError(raw)).toBe(NETWORK_ERROR_MESSAGE);
    }
    expect(NETWORK_ERROR_MESSAGE.toLowerCase()).toContain("before trying again");
  });

  it("maps Paynow codes and says nothing was charged when that is true", () => {
    expect(friendlyPaymentError("paynow_timeout")).toMatch(/nothing was charged/i);
    expect(friendlyPaymentError("paynow_unreachable")).toMatch(/nothing was charged/i);
    expect(friendlyPaymentError("paynow_not_configured")).toMatch(/unavailable/i);
    expect(friendlyPaymentError("already_paid")).toMatch(/already been paid/i);
  });

  it("passes through messages the database wrote for the user", () => {
    const rate = "Too many top-up attempts. Please wait a while before trying again.";
    expect(friendlyPaymentError(rate)).toBe(rate);
    const limited = "Your wallet is limited. Contact support.";
    expect(friendlyPaymentError({ message: limited })).toBe(limited);
    const funds = "Insufficient available balance. $5.00 is reserved against active jobs.";
    expect(friendlyPaymentError(funds)).toBe(funds);
  });

  it("never shows an unknown machine token", () => {
    expect(friendlyPaymentError("some_new_internal_code")).toBe(GENERIC_PAYMENT_ERROR);
    expect(friendlyPaymentError("some_new_internal_code", "custom")).toBe("custom");
  });

  it("falls back on empty or non-error input", () => {
    expect(friendlyPaymentError(undefined)).toBe(GENERIC_PAYMENT_ERROR);
    expect(friendlyPaymentError(null)).toBe(GENERIC_PAYMENT_ERROR);
    expect(friendlyPaymentError("   ")).toBe(GENERIC_PAYMENT_ERROR);
    expect(friendlyPaymentError(42)).toBe(GENERIC_PAYMENT_ERROR);
  });
});

describe("topupAmountError", () => {
  it("accepts the supported range", () => {
    expect(topupAmountError(1)).toBeNull();
    expect(topupAmountError(50)).toBeNull();
    expect(topupAmountError(100000)).toBeNull();
  });
  it("rejects zero, negative, NaN and sub-minimum amounts", () => {
    expect(topupAmountError(0)).toBe("Enter an amount");
    expect(topupAmountError(-5)).toBe("Enter an amount");
    expect(topupAmountError(Number.NaN)).toBe("Enter an amount");
    expect(topupAmountError("")).toBe("Enter an amount");
    expect(topupAmountError(0.5)).toMatch(/minimum/i);
    expect(topupAmountError(0.01)).toMatch(/minimum/i);
  });
  it("rejects amounts over the maximum", () => {
    expect(topupAmountError(100001)).toMatch(/maximum/i);
  });
});
