import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");

describe("account closure refund wording (0194)", () => {
  const terms = read("src/routes/terms.tsx");
  const privacy = read("src/routes/privacy.tsx");
  const card = read("src/components/ClosureRefundCard.tsx");
  const sql = readFileSync(
    "supabase/migrations/20261127150000_0194_account_closure_credit_refund.sql",
    "utf8",
  )
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join(" ");

  it("refunds only unused purchased credit, never promotional credit", () => {
    expect(terms).toMatch(/refunds the unused Commission Credit the Driver bought/);
    expect(terms).toMatch(/Promotional credit is never refunded or paid out/);
    expect(privacy).toMatch(/Promotional credit has no cash value and is not refunded/);
    expect(card).toMatch(/is not refunded/);
  });
  it("does not promise automatic or instant refunds, or a wallet withdrawal", () => {
    for (const t of [terms, privacy, card]) {
      expect(t).not.toMatch(/instant(ly)? refund|automatic(ally)? refund|withdraw your credit/i);
    }
  });
  it("is recorded by a super admin with a step-up and a reference, and leaves promo_balance alone", () => {
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'super_admin'\)/);
    expect(sql).toMatch(/perform public\.require_aal2\(\)/);
    expect(sql).toMatch(/refund_reference/);
    expect(sql).not.toMatch(/set promo_balance/);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });
});
