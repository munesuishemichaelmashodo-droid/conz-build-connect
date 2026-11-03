import { describe, expect, it } from "vitest";
import {
  defaultPayChoice,
  paynowDetail,
  paynowLabel,
} from "@/components/payments/usePaymentOptions";

describe("payment option labels", () => {
  it("before the switch: Paynow as today, selected first", () => {
    const o = { paynow: true, paynowAsCard: false, payonify: false };
    expect(paynowLabel(o)).toBe("Paynow");
    expect(paynowDetail(o)).toMatch(/EcoCash, card/);
    expect(defaultPayChoice(o)).toBe("paynow");
  });
  it("a tester before the switch still starts on Paynow", () => {
    expect(defaultPayChoice({ paynow: true, paynowAsCard: false, payonify: true })).toBe("paynow");
  });
  it("after the switch: EcoCash first, Paynow offered as the card option", () => {
    const o = { paynow: true, paynowAsCard: true, payonify: true };
    expect(defaultPayChoice(o)).toBe("payonify");
    expect(paynowLabel(o)).toBe("Card (Visa / Mastercard)");
    expect(paynowDetail(o)).toMatch(/Visa or Mastercard/);
  });
  it("EcoCash only when Paynow isn't set up", () => {
    expect(defaultPayChoice({ paynow: false, paynowAsCard: false, payonify: true })).toBe(
      "payonify",
    );
  });
});
