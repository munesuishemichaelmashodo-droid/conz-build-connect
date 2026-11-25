// Direct payments (customer pays the driver; 0176). ConZ does not handle the money, so it never says a direct
// payment was "verified": the strongest fact it holds is the DRIVER's own confirmation that they received it.
// A screenshot or the customer's word is never shown as proof of payment.

export const DIRECT_PAYMENT_METHODS = [
  "cash",
  "ecocash",
  "onemoney",
  "innbucks",
  "bank_transfer",
  "other",
] as const;
export type DirectPaymentMethod = (typeof DIRECT_PAYMENT_METHODS)[number];

export type DirectPaymentConfirmation = {
  method: DirectPaymentMethod;
  amount: number;
  agreedAmount: number;
  reference: string | null;
  confirmedAt: string;
};

export type DisputeState = "none" | "open" | "resolved";

const METHOD_LABEL: Record<DirectPaymentMethod, string> = {
  cash: "Cash",
  ecocash: "EcoCash",
  onemoney: "OneMoney",
  innbucks: "InnBucks",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export function directMethodLabel(m: unknown): string {
  return typeof m === "string" && m in METHOD_LABEL
    ? METHOD_LABEL[m as DirectPaymentMethod]
    : "Other";
}

export function parseConfirmation(row: unknown): DirectPaymentConfirmation | null {
  const r = row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  if (!r || typeof r.confirmed_at !== "string") return null;
  const amount = Number(r.amount);
  const agreed = Number(r.agreed_amount);
  if (!Number.isFinite(amount) || !Number.isFinite(agreed)) return null;
  return {
    method: (DIRECT_PAYMENT_METHODS as readonly string[]).includes(String(r.method))
      ? (r.method as DirectPaymentMethod)
      : "other",
    amount,
    agreedAmount: agreed,
    reference: typeof r.reference === "string" && r.reference ? r.reference : null,
    confirmedAt: r.confirmed_at,
  };
}

/** Disputes for one job → one state: any open one wins. */
export function disputeState(rows: { status?: unknown }[] | null | undefined): DisputeState {
  const list = rows ?? [];
  if (list.length === 0) return "none";
  return list.some((d) => d.status !== "resolved") ? "open" : "resolved";
}

export function disputeLabel(s: DisputeState): string {
  return s === "none" ? "No dispute" : s === "open" ? "Dispute open" : "Dispute resolved";
}

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * The payment-status line for a direct-pay job. `full` adds amount and reference (the job's own parties);
 * the shareable public receipt passes full=false and shows only that the driver confirmed, and when.
 */
export function directPaymentStatusLine(
  c: DirectPaymentConfirmation | null,
  full: boolean,
): string {
  if (!c) return "Not confirmed by the driver. Con Z did not handle this payment.";
  const base = `Driver confirmed receiving it on ${when(c.confirmedAt)}`;
  if (!full) return `${base}. Con Z did not handle this payment.`;
  const ref = c.reference ? `, reference ${c.reference}` : "";
  const differs =
    Math.round(c.amount * 100) !== Math.round(c.agreedAmount * 100)
      ? ` (agreed price ${money(c.agreedAmount)})`
      : "";
  return `${base}: ${money(c.amount)} by ${directMethodLabel(c.method)}${ref}${differs}. Con Z did not handle this payment.`;
}
