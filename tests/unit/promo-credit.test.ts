import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMO_CREDIT,
  parsePromoCredit,
  promoCopy,
  promoCreditSentence,
  promoCreditTerms,
} from "@/lib/promo-credit";

const on = { enabled: true, amount: 20 };

describe("parsePromoCredit", () => {
  it("is off with $20 when the read gives nothing usable", () => {
    expect(parsePromoCredit(null)).toEqual(DEFAULT_PROMO_CREDIT);
    expect(parsePromoCredit("nope")).toEqual(DEFAULT_PROMO_CREDIT);
    expect(parsePromoCredit({ enabled: "true", amount: -5 })).toEqual({
      enabled: false,
      amount: 20,
    });
  });
  it("reads the flag and a sane amount", () => {
    expect(parsePromoCredit({ enabled: true, amount: 25 })).toEqual({ enabled: true, amount: 25 });
    expect(parsePromoCredit({ enabled: true, amount: 5000 })).toEqual({
      enabled: true,
      amount: 20,
    });
  });
});

describe("promoCopy", () => {
  const legacy = [
    "Your first completed job has no commission. Part of it is held while a job is active.",
    "Your first completed job is commission-free.",
    "It is charged when the job is completed (your first completed job has no commission), and released.",
    "Your first completed job has no Con Z commission. After that the commission is 7% of the full job price.",
  ];

  it("leaves every sentence exactly as it is while the credit is off", () => {
    for (const t of legacy) expect(promoCopy(t, DEFAULT_PROMO_CREDIT)).toBe(t);
  });

  it("replaces the free-first-job promise once the credit is on", () => {
    for (const t of legacy) {
      const out = promoCopy(t, on);
      expect(out).not.toMatch(/first completed job/i);
      expect(out).not.toMatch(/commission-free/i);
    }
  });

  it("says what the credit is: one-time, commission only, not cash, not withdrawable", () => {
    const s = promoCreditSentence(20);
    expect(s).toContain("$20");
    expect(s).toMatch(/one-time/);
    expect(s).toMatch(/only pay Con Z commission/);
    expect(s).toMatch(/not cash/);
    expect(s).toMatch(/cannot be withdrawn or transferred/);
    expect(s).not.toMatch(/wallet|escrow|we hold/i);
  });

  it("keeps the 7% sentence that follows in the Help answer", () => {
    const out = promoCopy(legacy[3], on);
    expect(out).toContain("The commission is 7% of the full job price.");
  });

  it("formats a non-whole amount with cents", () => {
    expect(promoCreditSentence(12.5)).toContain("$12.50");
  });

  it("gives the Terms a factual sentence with the same limits", () => {
    const t = promoCreditTerms(20);
    expect(t).toMatch(/one-time promotional commission credit of \$20/);
    expect(t).toMatch(/no cash value/);
    expect(t).toMatch(/cannot be withdrawn or transferred/);
  });
});
