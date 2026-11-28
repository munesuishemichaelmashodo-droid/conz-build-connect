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

  it("never shows the retired free-first-job promise while the credit is off or not read yet", () => {
    for (const t of legacy) {
      const out = promoCopy(t, DEFAULT_PROMO_CREDIT);
      expect(out).not.toMatch(/first completed job/i);
      expect(out).not.toMatch(/commission-free/i);
      expect(out).not.toMatch(/promotional credit/i);
    }
    expect(promoCopy(legacy[0], DEFAULT_PROMO_CREDIT)).toBe(
      "Part of it is held while a job is active.",
    );
    expect(promoCopy(legacy[1], DEFAULT_PROMO_CREDIT)).toBe("");
    expect(promoCopy(legacy[2], DEFAULT_PROMO_CREDIT)).toBe(
      "It is charged when the job is completed, and released.",
    );
    expect(promoCopy(legacy[3], DEFAULT_PROMO_CREDIT)).toBe(
      "The commission is 7% of the full job price.",
    );
  });

  it("leaves text without the retired phrases unchanged", () => {
    const plain = "7% commission on the total agreed price, including materials and transport.";
    expect(promoCopy(plain, DEFAULT_PROMO_CREDIT)).toBe(plain);
    expect(promoCopy(plain, on)).toBe(plain);
  });

  it("rewrites the walkthrough and Help wording in both states", () => {
    const walk =
      "Your first completed job has no commission. After that, Con Z commission is 7% of the full job value.";
    expect(promoCopy(walk, DEFAULT_PROMO_CREDIT)).toBe(
      "Con Z commission is 7% of the full job value.",
    );
    expect(promoCopy(walk, on)).toMatch(
      /^When you are verified you get a one-time \$20 promotional allowance for the Con Z commission on your first completed job\..* Con Z commission is 7%/,
    );
  });

  it("replaces the free-first-job promise once the credit is on", () => {
    for (const t of legacy) {
      const out = promoCopy(t, on);
      // the retired promise was "no commission on the first job"; the allowance pays that commission instead (0189)
      expect(out).not.toMatch(/has no (Con Z )?commission/i);
      expect(out).not.toMatch(/commission-free/i);
    }
  });

  it("says what the credit is: one-time, commission only, not cash, not withdrawable", () => {
    const s = promoCreditSentence(20);
    expect(s).toContain("$20");
    expect(s).toMatch(/one-time/);
    expect(s).toMatch(/Con Z commission on your first completed job/);
    expect(s).toMatch(/does not use then expires/);
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
    expect(t).toMatch(/one-time promotional allowance of \$20/);
    expect(t).toMatch(/first completed job: if that commission is less, the unused part expires/);
    expect(t).toMatch(/A cancelled job does not use it/);
    expect(t).toMatch(/no cash value/);
    expect(t).toMatch(/cannot be withdrawn or transferred/);
  });
});

describe("Terms page source", () => {
  it("reads the promotion on the server and never states the retired free first job", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/routes/terms.tsx", "utf8");
    expect(src).toMatch(/loader: async \(\) => \(\{ promo: await fetchPromoCredit\(\) \}\)/);
    expect(src).not.toMatch(/first-job-free|first completed job/i);
  });
});
