import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REPORT_CATEGORIES,
  isPhysicalSafety,
  isUrgentCategory,
  reportCategoryLabel,
} from "@/lib/report-categories";

describe("incident categories (0192)", () => {
  it("covers the launch incident list", () => {
    for (const c of [
      "accident_injury",
      "theft_missing",
      "damage_shortage",
      "no_show",
      "payment",
      "false_delivery",
      "threats",
      "unsafe_cargo",
      "fraud_scam",
      "account_compromise",
      "data_exposure",
      "platform_outage",
    ]) {
      expect(REPORT_CATEGORIES as readonly string[]).toContain(c);
      expect(reportCategoryLabel(c)).not.toBe(reportCategoryLabel("general"));
    }
  });
  it("matches the database's urgent rule", () => {
    const sql = readFileSync("supabase/migrations/20261127130000_0192_incident_cases.sql", "utf8");
    const m = sql.match(/new\.urgent := new\.category in \(([^)]*)\)/);
    const db = (m?.[1] ?? "").match(/'([a-z_]+)'/g)?.map((x) => x.replace(/'/g, "")) ?? [];
    expect(db.length).toBeGreaterThan(5);
    for (const c of REPORT_CATEGORIES) expect(isUrgentCategory(c)).toBe(db.includes(c));
  });
  it("physical-safety reports send people to the emergency services first", () => {
    expect(isPhysicalSafety("accident_injury")).toBe(true);
    const page = readFileSync("src/routes/_authenticated/report.tsx", "utf8");
    expect(page).toMatch(/call the police \(995\) or emergency services \(999\) first/);
    expect(page).not.toMatch(/24\/7|round the clock|we will send help/i);
  });
  it("the recovery script keeps cases and their guards", () => {
    const rb = readFileSync("supabase/rollbacks/20261127130000_0192_rollback.sql", "utf8").replace(
      /--.*$/gm,
      "",
    );
    expect(rb).not.toMatch(/\bdrop\b|delete from|case_guard|append_only|alter table/i);
  });
});
