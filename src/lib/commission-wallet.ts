// ConZ Commission Credit: wording and labels for the driver's wallet screen (owner's MVP mandate, 26/11/2026).
// The balance is prepaid credit used ONLY to pay ConZ's commission. Customers pay drivers directly; ConZ never holds
// transport fares, so nothing here is "earnings" and nothing can be withdrawn or transferred.

const TX_LABEL: Record<string, string> = {
  topup: "Top-up",
  paynow_topup: "Top-up (Paynow)",
  manual_topup: "Top-up (approved by Con Z)",
  reserve: "Commission reserved for a job",
  hold: "Commission reserved for a job",
  release: "Reserved commission released",
  commission: "Commission charged",
  direct_commission: "Commission charged",
  refund: "Commission returned",
  dispute_commission_refund: "Commission returned after a dispute",
  adjustment: "Correction by Con Z",
  promo_credit: "Promotional credit added",
  promo_grant: "Promotional credit added",
  referral_bonus: "Referral credit",
  withdrawal: "Withdrawal (old system)",
};

export function walletTxLabel(type: unknown): string {
  const t = String(type ?? "");
  if (t in TX_LABEL) return TX_LABEL[t];
  if (t.includes("promo")) return "Promotional credit";
  if (t.includes("commission")) return "Commission charged";
  if (t.includes("withdraw")) return "Withdrawal (old system)";
  return t.replace(/_/g, " ") || "Entry";
}

export const COMMISSION_WALLET_TITLE = "ConZ Commission Credit";

export const COMMISSION_WALLET_RULES: string[] = [
  "This is prepaid credit used only to pay Con Z's commission. It is not your earnings.",
  "Customers pay you directly for every job. Con Z never holds or passes on transport money.",
  "Con Z's commission is 7% of the agreed job price (materials and transport together).",
  "When you accept a job, its 7% is reserved from your available credit. If you do not have enough, you cannot accept.",
  "When the delivery is verified, the reserved amount is charged once. If the job is cancelled under the rules, it is released once.",
  "Credit cannot be withdrawn, cashed out or transferred. If you topped up by mistake, contact support.",
];

/** When a top-up turns into usable credit. */
export const TOPUP_AVAILABILITY =
  "Credit is added only after Paynow confirms the payment to Con Z. Returning from the payment page is not enough; if it takes long, this page checks with Paynow again.";

export type TopupReceipt = {
  paymentId: string;
  amount: number;
  currency: string;
  paidAt: string;
  provider: string;
  providerReference: string | null;
};

export function topupReceiptLines(r: TopupReceipt): [string, string][] {
  return [
    ["Paid to", "Navysky Innovations (Private) Limited (Con Z)"],
    ["For", "Con Z commission credit (prepaid, non-withdrawable)"],
    ["Amount", `${r.currency} ${r.amount.toFixed(2)}`],
    ["Date", new Date(r.paidAt).toLocaleString()],
    ["Paid through", r.provider],
    ["Provider reference", r.providerReference ?? "Not supplied"],
    ["Con Z receipt no.", `CONZ-TOP-${r.paymentId.slice(0, 8).toUpperCase()}`],
  ];
}
