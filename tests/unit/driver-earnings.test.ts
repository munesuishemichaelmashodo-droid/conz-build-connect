import { describe, expect, it } from "vitest";
import { payableStatusLabel, summarizePayables, type PayableRow } from "@/lib/driver-earnings";

const row = (over: Partial<PayableRow>): PayableRow => ({
  id: "p",
  job_id: "j",
  gross_amount: 300,
  commission: 21,
  amount: 279,
  status: "payable",
  created_at: "2026-11-24T10:00:00Z",
  ...over,
});

describe("summarizePayables", () => {
  it("is all zero with no rows", () => {
    expect(summarizePayables([])).toEqual({
      owed: 0,
      held: 0,
      paidOut: 0,
      commission: 0,
      gross: 0,
      count: 0,
    });
  });

  it("splits owed and paid out, and counts held inside owed", () => {
    const s = summarizePayables([
      row({ id: "a", status: "payable" }),
      row({ id: "b", status: "held" }),
      row({ id: "c", status: "payout_pending" }),
      row({ id: "d", status: "paid_out" }),
    ]);
    expect(s.owed).toBe(837);
    expect(s.held).toBe(279);
    expect(s.paidOut).toBe(279);
    expect(s.commission).toBe(84);
    expect(s.gross).toBe(1200);
    expect(s.count).toBe(4);
  });

  it("ignores reversed payables", () => {
    const s = summarizePayables([row({ status: "reversed" }), row({ id: "x" })]);
    expect(s.count).toBe(1);
    expect(s.owed).toBe(279);
  });

  it("adds money in cents (no float drift) and accepts numeric strings from Postgres", () => {
    const s = summarizePayables([
      row({ gross_amount: "0.10", commission: "0.01", amount: "0.09" }),
      row({ gross_amount: "0.20", commission: "0.01", amount: "0.19" }),
    ]);
    expect(s.owed).toBe(0.28);
    expect(s.commission).toBe(0.02);
  });
});

describe("payableStatusLabel", () => {
  it("never says escrow, protected or guaranteed", () => {
    for (const st of ["payable", "held", "payout_pending", "paid_out", "reversed"] as const) {
      expect(payableStatusLabel(st)).not.toMatch(/escrow|protect|guarantee/i);
    }
  });
});
