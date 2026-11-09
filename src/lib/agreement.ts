/** Wording and shape for the job agreement card (migration 0157). The fare itself always comes from the job. */
export type JobAgreement = {
  id: string;
  job_id: string;
  version: number;
  proposed_by: string;
  fare: number;
  payment_method: "cash" | "ecocash" | "bank_transfer" | "other";
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
};

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "ecocash", label: "EcoCash" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
] as const;

export const PAYMENT_TIMINGS = [
  { value: "on_delivery", label: "When the load is delivered" },
  { value: "on_pickup", label: "When the load is picked up" },
  { value: "before_pickup", label: "Before pickup" },
  { value: "other", label: "Another time (say which in the notes)" },
] as const;

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
  row: Pick<JobAgreement, "fare" | "payment_method" | "payment_timing" | "deposit_amount">,
): string {
  const fare = `$${Number(row.fare).toFixed(2)}`;
  const deposit =
    Number(row.deposit_amount) > 0
      ? `, with a $${Number(row.deposit_amount).toFixed(2)} deposit paid to the driver`
      : "";
  return `${fare} paid directly to the driver by ${methodLabel(row.payment_method).toLowerCase()}, ${timingLabel(row.payment_timing).toLowerCase()}${deposit}.`;
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
