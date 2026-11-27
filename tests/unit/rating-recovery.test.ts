import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The 0182 recovery script must never reopen ratings (owner rule: recovery is forward-safe).
describe("0182 recovery script", () => {
  const sql = readFileSync("supabase/rollbacks/20261126140000_0182_rollback.sql", "utf8").replace(
    /--.*$/gm,
    "",
  );
  it("keeps ratings private and read-only for clients", () => {
    expect(sql).not.toMatch(/alter policy|using \(true\)|\bgrant\b|\bdrop\b/i);
  });
  it("only resets the two average triggers", () => {
    expect(
      sql.match(/create or replace function public\.(\w+)/gi)?.map((m) => m.split(".")[1]),
    ).toEqual(["tg_rating_aggregate", "tg_customer_rating_aggregate"]);
  });
});
