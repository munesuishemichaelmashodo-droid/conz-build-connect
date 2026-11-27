import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseReconciliation,
  proofLine,
  reconFlagLabels,
  reconStateLabel,
  type ReconState,
} from "@/lib/direct-payment";

const STATES: ReconState[] = [
  "not_reported",
  "payment_reported",
  "receipt_claimed",
  "both_confirmed",
  "independently_confirmed",
  "disputed",
  "reversal_reported",
];

describe("direct payment reconciliation wording (0188)", () => {
  it("only an admin check of a bank or provider record reads as confirmed by Con Z", () => {
    for (const s of STATES) {
      const l = reconStateLabel(s);
      if (s === "independently_confirmed")
        expect(l).toBe("Checked by Con Z against a bank or provider record");
      else expect(l).not.toMatch(/checked by con z against|verified|guarantee|protected/i);
    }
    expect(reconStateLabel("receipt_claimed")).toMatch(/not checked by Con Z/);
    expect(reconStateLabel("both_confirmed")).toMatch(/not checked by Con Z/);
    expect(reconStateLabel("payment_reported")).toMatch(/not confirmed/);
  });
  it("says a screenshot alone is not proof", () => {
    expect(
      proofLine({
        evidence: [{ kind: "screenshot", by_role: "customer", at: "" }],
        screenshot_only: true,
      }),
    ).toBe("1 file attached as proof. Screenshots alone do not confirm a payment.");
    expect(proofLine({ evidence: [], screenshot_only: false })).toBeNull();
  });
  it("explains each flag in plain words", () => {
    expect(reconFlagLabels(["references_differ", "customer_amount_differs"])).toEqual([
      "The customer and the driver gave different payment references.",
      "The customer's amount differs from what was agreed.",
    ]);
  });
  it("ignores a malformed response", () => {
    expect(parseReconciliation(null)).toBeNull();
    expect(parseReconciliation({ stages: "x" })).toBeNull();
  });
});

describe("0188 migration keeps the business model", () => {
  const sql = readFileSync(
    "supabase/migrations/20261126200000_0188_direct_payment_reconciliation.sql",
    "utf8",
  ).replace(/--.*$/gm, "");
  it("never touches wallets, commission, promo credit or the job price", () => {
    expect(sql).not.toMatch(
      /public\.wallets|wallet_transactions|held_commission|promo|commission_amount|update public\.jobs/i,
    );
  });
  it("refuses a screenshot as an independent source and keeps history append-only", () => {
    expect(sql).toMatch(/A screenshot alone is not proof of payment/);
    expect(sql).toMatch(/before update or delete on public\.direct_payment_stage_reviews/);
    expect(sql).toMatch(/before update or delete on public\.direct_payment_evidence/);
  });
  it("the recovery script keeps the guards", () => {
    const rb = readFileSync("supabase/rollbacks/20261126200000_0188_rollback.sql", "utf8").replace(
      /--.*$/gm,
      "",
    );
    expect(rb).not.toMatch(/\bdrop\b|delete from|disable trigger/i);
  });
});

describe("local stand-in", () => {
  it("marks its reconciliation as simulated and the panel says so", () => {
    const mock = readFileSync("scripts/dev/mock-supabase.mjs", "utf8");
    const rec = mock.slice(mock.indexOf("job_payment_reconciliation:"), mock.indexOf("attach_stage_payment_evidence:"));
    expect(rec).toMatch(/simulated: true/);
    expect(readFileSync("src/components/payments/DirectPaymentPanel.tsx", "utf8")).toMatch(/Simulated sample data from the local stand-in/);
  });
});
