import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paynowStartDecision, readPaynowMode } from "@/lib/paynow.server";

// 0190: simulated tests only. No real Paynow call is made anywhere in this file.
const db = (data: unknown, error: unknown = null) => ({ rpc: async () => ({ data, error }) });

describe("Paynow mode (fail closed)", () => {
  it("reads live and test, and treats everything else as off", async () => {
    expect(await readPaynowMode(db("live"))).toBe("live");
    expect(await readPaynowMode(db("test"))).toBe("test");
    for (const v of ["off", "LIVE", "", null, 1, { mode: "live" }])
      expect(await readPaynowMode(db(v))).toBe("off");
  });
  it("is off when the database cannot be read", async () => {
    expect(await readPaynowMode(db("live", { message: "boom" }))).toBe("off");
    expect(await readPaynowMode({ rpc: async () => Promise.reject(new Error("network")) })).toBe(
      "off",
    );
  });
  it("only LIVE starts a real payment", () => {
    expect(paynowStartDecision("live")).toEqual({ start: true });
    expect(paynowStartDecision("test")).toEqual({ start: false, error: "paynow_test_mode" });
    expect(paynowStartDecision("off")).toEqual({ start: false, error: "payments_off" });
  });
  it("both payment starts check the mode before creating a payment or calling Paynow", () => {
    const src = readFileSync("src/lib/paynow.functions.ts", "utf8");
    const topup = src.slice(
      src.indexOf("export const initiatePaynowTopup"),
      src.indexOf("export const initiateEscrowPayment"),
    );
    expect(topup.indexOf("paynowStartDecision")).toBeGreaterThan(0);
    expect(topup.indexOf("paynowStartDecision")).toBeLessThan(topup.indexOf('.from("payments")'));
    expect(topup.indexOf("paynowStartDecision")).toBeLessThan(
      topup.indexOf("initiatePaynowTransaction({"),
    );
    const escrow = src.slice(src.indexOf("export const initiateEscrowPayment"));
    expect(escrow.indexOf("paynowStartDecision")).toBeLessThan(
      escrow.indexOf("initiatePaynowTransaction({"),
    );
  });
  it("the database never credits on Awaiting Delivery and the recovery never restores that", () => {
    const sql = readFileSync(
      "supabase/migrations/20261127110000_0190_paynow_fail_closed_modes.sql",
      "utf8",
    );
    expect(sql).toMatch(/_s = 'awaiting delivery' then[\s\S]*awaiting_settlement_no_credit/);
    const rb = readFileSync("supabase/rollbacks/20261127110000_0190_rollback.sql", "utf8").replace(
      /--.*$/gm,
      "",
    );
    expect(rb).not.toMatch(/create or replace function|\bdrop\b/i);
  });
});
