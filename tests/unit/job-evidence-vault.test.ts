import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin evidence view (0193)", () => {
  const ui = readFileSync("src/components/evidence/JobEvidenceVault.tsx", "utf8");
  const sql = readFileSync(
    "supabase/migrations/20261127140000_0193_job_evidence_vault.sql",
    "utf8",
  );
  it("reads every section through its own access-checked function", () => {
    for (const f of ["admin_job_history", "job_evidence_record", "job_payment_reconciliation"])
      expect(ui).toContain(`"${f}"`);
  });
  it("tells the admin that opening it is logged, and the database logs it", () => {
    expect(ui).toMatch(/opening this is logged/);
    expect(sql).toMatch(/log_admin_action\('job_evidence_viewed'/);
  });
  it("keeps submitted material apart from what was checked", () => {
    expect(ui).toMatch(/photos are submitted; reports are statements/);
  });
  it("is admin-only and writes nothing to the job", () => {
    expect(sql).toMatch(/has_role\(auth\.uid\(\), 'admin'\)/);
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(
      /update public\.|insert into public\.(?!admin_audit_log)|delete from/i,
    );
  });
});
