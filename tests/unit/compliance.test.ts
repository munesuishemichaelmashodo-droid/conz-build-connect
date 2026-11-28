import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BADGE_NOTE, STATE_LABEL, badgeLabel } from "@/lib/compliance";

describe("driver document checks (0191)", () => {
  it("each badge names one checked fact and its validity", () => {
    expect(
      badgeLabel({
        doc_type: "driving_licence",
        licence_class: "C",
        insurance_type: null,
        valid_to: "2027-06-30",
      }),
    ).toMatch(/^Licence checked, class C, valid to 30 Jun 2027$/);
    expect(
      badgeLabel({
        doc_type: "identity",
        licence_class: null,
        insurance_type: null,
        valid_to: null,
      }),
    ).toBe("ID checked");
    expect(
      badgeLabel({
        doc_type: "insurance",
        licence_class: null,
        insurance_type: "goods_in_transit",
        valid_to: "2027-01-01",
      }),
    ).toMatch(/^Insurance evidence checked \(goods in transit\)/);
  });
  it("never claims a combined verification, cover or compliance", () => {
    const all = [BADGE_NOTE, ...Object.values(STATE_LABEL)].join(" ");
    expect(all).not.toMatch(/fully verified|verified driver|insured|guarantee(?!.*not)|compliant/i);
    expect(BADGE_NOTE).toMatch(/not a guarantee of insurance cover or of legal compliance/);
  });
  it("an upload is never shown as checked", () => {
    expect(STATE_LABEL.pending).toBe("Submitted, waiting for Con Z to check");
    const card = readFileSync("src/components/compliance/DriverComplianceCard.tsx", "utf8");
    expect(card).toMatch(/uploading alone does not mark it checked/);
  });
  it("the recovery script keeps records and guards", () => {
    const sql = readFileSync("supabase/rollbacks/20261127120000_0191_rollback.sql", "utf8").replace(
      /--.*$/gm,
      "",
    );
    expect(sql).not.toMatch(
      /\bdrop\b|delete from|trg_compliance_document_guard|events_append_only/i,
    );
  });
});
