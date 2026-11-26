/** Wording and shape for the job agreement card (migration 0157). The fare itself always comes from the job. */
export type JobAgreement = {
  id: string;
  job_id: string;
  version: number;
  proposed_by: string;
  fare: number;
  payment_method:
    "cash" | "ecocash" | "onemoney" | "innbucks" | "zipit" | "bank_transfer" | "other";
  payment_timing: "on_delivery" | "on_pickup" | "before_pickup" | "other";
  deposit_amount: number;
  pickup_window: string | null;
  delivery_window: string | null;
  inclusions: string | null;
  exclusions: string | null;
  status: "proposed" | "accepted" | "superseded" | "declined";
  customer_accepted_at: string | null;
  driver_accepted_at: string | null;
  created_at: string;
  // 0179: payment terms. Missing (undefined) before 0179 is applied.
  recipient_name?: string | null;
  recipient_account?: string | null;
  payment_instructions?: string | null;
  deposit_due?: "on_agreement" | "before_pickup" | "on_pickup" | null;
  deposit_reason?: string | null;
  cancellation_terms?: string | null;
  /** The exact method (0179); payment_method keeps only cash/ecocash/bank_transfer/other. */
  payment_channel?: JobAgreement["payment_method"] | null;
};

/** The method to show and edit: the exact channel when present (0179), else the older column. */
export const agreedMethod = (row: Pick<JobAgreement, "payment_method" | "payment_channel">) =>
  row.payment_channel ?? row.payment_method;

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "ecocash", label: "EcoCash" },
  { value: "onemoney", label: "OneMoney" },
  { value: "innbucks", label: "InnBucks" },
  { value: "zipit", label: "ZIPIT" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
] as const;

export const PAYMENT_TIMINGS = [
  { value: "on_delivery", label: "When the load is delivered" },
  { value: "on_pickup", label: "When the load is picked up" },
  { value: "before_pickup", label: "Before pickup" },
  { value: "other", label: "Another time (say which in the notes)" },
] as const;

/** When a deposit (or a full advance payment) is due (0179). */
export const DEPOSIT_DUES = [
  { value: "on_agreement", label: "As soon as the agreement is confirmed" },
  { value: "before_pickup", label: "Before pickup" },
  { value: "on_pickup", label: "When the load is picked up" },
] as const;
export const depositDueLabel = (v: string | null | undefined) =>
  DEPOSIT_DUES.find((m) => m.value === v)?.label ?? "At the agreed time";

export const methodLabel = (v: string) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;
export const timingLabel = (v: string) => PAYMENT_TIMINGS.find((m) => m.value === v)?.label ?? v;

/** The version people should look at: the open proposal, else the last accepted one, else nothing. */
export function currentAgreement(rows: JobAgreement[] | null | undefined): JobAgreement | null {
  const list = [...(rows ?? [])].sort((a, b) => b.version - a.version);
  return (
    list.find((r) => r.status === "proposed") ?? list.find((r) => r.status === "accepted") ?? null
  );
}

export type AgreementView = "none" | "waiting_for_other" | "needs_my_answer" | "agreed";

/** What the viewer should see and be able to do. */
export function agreementView(row: JobAgreement | null, userId: string | null): AgreementView {
  if (!row) return "none";
  if (row.status === "accepted") return "agreed";
  if (row.status === "proposed")
    return row.proposed_by === userId ? "waiting_for_other" : "needs_my_answer";
  return "none";
}

/** Plain-language statement of who pays whom: the fare always goes straight to the driver. */
export function payLine(
  row: Pick<JobAgreement, "fare" | "payment_method" | "payment_timing" | "deposit_amount"> &
    Partial<Pick<JobAgreement, "deposit_due" | "payment_channel">>,
): string {
  const fareN = Number(row.fare);
  const depN = Number(row.deposit_amount);
  const fare = `$${fareN.toFixed(2)}`;
  const method = methodLabel(agreedMethod(row)).toLowerCase();
  if (depN > 0 && Math.round(depN * 100) >= Math.round(fareN * 100)) {
    return `${fare} paid in full in advance, directly to the driver by ${method}, ${depositDueLabel(row.deposit_due).toLowerCase()}.`;
  }
  const due = row.deposit_due ? ` ${depositDueLabel(row.deposit_due).toLowerCase()}` : "";
  const deposit =
    depN > 0
      ? `, with a $${depN.toFixed(2)} deposit paid to the driver${due} (balance $${(fareN - depN).toFixed(2)})`
      : "";
  return `${fare} paid directly to the driver by ${method}, ${timingLabel(row.payment_timing).toLowerCase()}${deposit}.`;
}

/** The kind of payment plan, in words (0179). */
export function paymentPlanLabel(
  row: Pick<JobAgreement, "fare" | "deposit_amount" | "payment_timing">,
): string {
  const depN = Number(row.deposit_amount);
  if (depN <= 0)
    return row.payment_timing === "on_delivery" ? "Payment after delivery" : "No deposit";
  if (Math.round(depN * 100) >= Math.round(Number(row.fare) * 100)) return "Full advance payment";
  return "Deposit, then the balance";
}

/**
 * The deposit is the driver's to propose (migrations 0162, 0163). A customer's new version keeps the deposit that is in
 * force: the newest version still proposed or accepted (never a superseded or declined one). The database refuses any
 * other amount. `rows` are newest first.
 */
export function carriedDeposit(
  rows: Pick<JobAgreement, "status" | "deposit_amount">[] | null | undefined,
): number {
  const latest = (rows ?? []).find((r) => r.status === "proposed" || r.status === "accepted");
  const n = Number(latest?.deposit_amount ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
