import { describe, expect, it } from "vitest";
import {
  directMethodLabel,
  directPaymentStatusLine,
  disputeLabel,
  disputeState,
  parseConfirmation,
} from "@/lib/direct-payment";

const row = {
  method: "ecocash",
  amount: "400.00",
  agreed_amount: "400.00",
  reference: "MP2511.1044.A12345",
  confirmed_at: "2026-11-25T08:44:00Z",
};

describe("direct payment wording (0176)", () => {
  it("without a driver confirmation it never claims the payment happened", () => {
    const t = directPaymentStatusLine(null, true);
    expect(t).toMatch(/^Not confirmed by the driver/);
    expect(t).not.toMatch(/verified|paid|received/i);
  });

  it("a confirmation is the driver's, never ConZ verification", () => {
    const c = parseConfirmation(row)!;
    const full = directPaymentStatusLine(c, true);
    expect(full).toMatch(/^Driver confirmed receiving it on /);
    expect(full).toContain("$400.00 by EcoCash, reference MP2511.1044.A12345");
    expect(full).toContain("Con Z did not handle this payment.");
    expect(full).not.toMatch(/verified|guarantee|escrow|protected/i);
  });

  it("the public receipt shows only that the driver confirmed, not the amount or reference", () => {
    const pub = directPaymentStatusLine(parseConfirmation(row), false);
    expect(pub).not.toContain("MP2511");
    expect(pub).not.toContain("$400");
  });

  it("a confirmed amount that differs from the agreed price says so", () => {
    const c = parseConfirmation({ ...row, amount: "350.00" })!;
    expect(directPaymentStatusLine(c, true)).toContain("$350.00 by EcoCash");
    expect(directPaymentStatusLine(c, true)).toContain("(agreed price $400.00)");
  });

  it("reads rows defensively", () => {
    expect(parseConfirmation(null)).toBeNull();
    expect(parseConfirmation({ ...row, confirmed_at: undefined })).toBeNull();
    expect(parseConfirmation({ ...row, method: "bitcoin" })?.method).toBe("other");
    expect(directMethodLabel("bank_transfer")).toBe("Bank transfer");
    expect(directMethodLabel(42)).toBe("Other");
  });

  it("dispute status: none, open wins over resolved, all resolved", () => {
    expect(disputeState([])).toBe("none");
    expect(disputeState(null)).toBe("none");
    expect(disputeState([{ status: "resolved" }, { status: "open" }])).toBe("open");
    expect(disputeState([{ status: "resolved" }])).toBe("resolved");
    expect(disputeLabel("open")).toBe("Dispute open");
  });
});
