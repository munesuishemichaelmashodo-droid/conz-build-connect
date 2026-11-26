import { describe, expect, it } from "vitest";
import {
  COMMISSION_WALLET_RULES,
  COMMISSION_WALLET_TITLE,
  TOPUP_AVAILABILITY,
  topupReceiptLines,
  walletTxLabel,
} from "@/lib/commission-wallet";

describe("commission wallet wording", () => {
  it("labels every ledger type the database writes", () => {
    expect(walletTxLabel("reserve")).toBe("Commission reserved for a job");
    expect(walletTxLabel("release")).toBe("Reserved commission released");
    expect(walletTxLabel("direct_commission")).toBe("Commission charged");
    expect(walletTxLabel("dispute_commission_refund")).toMatch(/returned/);
    expect(walletTxLabel("promo_something")).toBe("Promotional credit");
    expect(walletTxLabel("withdrawal_paid")).toBe("Withdrawal (old system)");
    expect(walletTxLabel(null)).toBe("Entry");
  });
  it("never calls credit earnings, withdrawable or protected", () => {
    const all = [COMMISSION_WALLET_TITLE, TOPUP_AVAILABILITY, ...COMMISSION_WALLET_RULES].join(" ");
    expect(all).not.toMatch(/withdraw (your|it)|escrow|guarant|protected|your earnings are/i);
    expect(all).toMatch(/not your earnings/);
    expect(all).toMatch(/cannot be withdrawn/);
    expect(all).toMatch(/7%/);
  });
  it("a top-up receipt names Navysky, the provider reference and a stable receipt number", () => {
    const lines = Object.fromEntries(
      topupReceiptLines({
        paymentId: "abcdef12-0000-0000-0000-000000000000",
        amount: 10,
        currency: "USD",
        paidAt: "2026-11-26T10:00:00Z",
        provider: "Paynow",
        providerReference: "57160075",
      }),
    );
    expect(lines["Paid to"]).toMatch(/Navysky/);
    expect(lines["Provider reference"]).toBe("57160075");
    expect(lines["Con Z receipt no."]).toBe("CONZ-TOP-ABCDEF12");
    expect(lines["Amount"]).toBe("USD 10.00");
  });
});
