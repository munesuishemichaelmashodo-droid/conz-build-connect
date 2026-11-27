// Direct payments (customer pays the driver; 0176). ConZ does not handle the money, so it never says a direct
// payment was "verified": the strongest fact it holds is the DRIVER's own confirmation that they received it.
// A screenshot or the customer's word is never shown as proof of payment.

export const DIRECT_PAYMENT_METHODS = [
  "cash",
  "ecocash",
  "onemoney",
  "innbucks",
  "zipit",
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
  zipit: "ZIPIT",
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

// ---------------------------------------------------------------------------------------------------------------
// 0179: payments recorded per stage (deposit, balance, or one full payment). Each stage holds the customer's claim,
// the driver's confirmation and the customer's agreement, all write-once. None of them is proof of settlement.

export type PaymentStageName = "deposit" | "balance" | "full";

export type PlannedStage = {
  stage: PaymentStageName;
  expectedAmount: number;
  due: string | null;
  methodAgreed: string | null;
  recipientName: string | null;
  recipientAccount: string | null;
  instructions: string | null;
};

export type PaymentStageRecord = {
  stage: PaymentStageName;
  expectedAmount: number;
  customerClaimedAt: string | null;
  customerMethod: string | null;
  customerAmount: number | null;
  customerReference: string | null;
  driverConfirmedAt: string | null;
  driverMethod: string | null;
  driverAmount: number | null;
  driverReference: string | null;
  customerAcknowledgedAt: string | null;
};

const STAGES: readonly PaymentStageName[] = ["deposit", "balance", "full"];
const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parsePlan(rows: unknown): PlannedStage[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && STAGES.includes((r as { stage: PaymentStageName }).stage))
    .map((r: Record<string, unknown>) => ({
      stage: r.stage as PaymentStageName,
      expectedAmount: num(r.expected_amount) ?? 0,
      due: str(r.due),
      methodAgreed: str(r.method_agreed),
      recipientName: str(r.recipient_name),
      recipientAccount: str(r.recipient_account),
      instructions: str(r.payment_instructions),
    }));
}

export function parseStageRecords(rows: unknown): PaymentStageRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && STAGES.includes((r as { stage: PaymentStageName }).stage))
    .map((r: Record<string, unknown>) => ({
      stage: r.stage as PaymentStageName,
      expectedAmount: num(r.expected_amount) ?? 0,
      customerClaimedAt: str(r.customer_claimed_at),
      customerMethod: str(r.customer_method),
      customerAmount: num(r.customer_amount),
      customerReference: str(r.customer_reference),
      driverConfirmedAt: str(r.driver_confirmed_at),
      driverMethod: str(r.driver_method),
      driverAmount: num(r.driver_amount),
      driverReference: str(r.driver_reference),
      customerAcknowledgedAt: str(r.customer_acknowledged_at),
    }));
}

export function stageName(s: PaymentStageName): string {
  return s === "deposit" ? "Deposit" : s === "balance" ? "Balance" : "Payment";
}

export type StageStatus =
  "not_recorded" | "customer_says_paid" | "driver_confirmed" | "customer_acknowledged" | "disputed";

/** Where one stage stands, from the two parties' statements. An open dispute on the job wins. */
export function stageStatus(
  rec: PaymentStageRecord | null | undefined,
  dispute: DisputeState,
): StageStatus {
  if (dispute === "open") return "disputed";
  if (rec?.driverConfirmedAt && rec.customerAcknowledgedAt) return "customer_acknowledged";
  if (rec?.driverConfirmedAt) return "driver_confirmed";
  if (rec?.customerClaimedAt) return "customer_says_paid";
  return "not_recorded";
}

export function stageStatusLabel(s: StageStatus): string {
  switch (s) {
    case "not_recorded":
      return "Not recorded yet";
    case "customer_says_paid":
      return "Customer says paid; waiting for the driver to confirm";
    case "driver_confirmed":
      return "Driver confirmed receiving it";
    case "customer_acknowledged":
      return "Driver confirmed and customer agreed";
    case "disputed":
      return "Disputed";
  }
}

/** True when a statement differs from the agreed amount, or the two statements differ. */
export function stageAmountsDisagree(rec: PaymentStageRecord | null | undefined): boolean {
  if (!rec) return false;
  const c = (n: number) => Math.round(n * 100);
  const vals = [rec.customerAmount, rec.driverAmount].filter((n): n is number => n != null);
  return (
    vals.some((v) => c(v) !== c(rec.expectedAmount)) ||
    (vals.length === 2 && c(vals[0]) !== c(vals[1]))
  );
}

const DUE_LABEL: Record<string, string> = {
  on_agreement: "when the agreement is confirmed",
  before_pickup: "before pickup",
  on_pickup: "when the load is picked up",
  on_delivery: "when the load is delivered",
  other: "at the time agreed",
  as_agreed: "as agreed with the driver",
};
export function dueLabel(due: string | null | undefined): string {
  return (due && DUE_LABEL[due]) || "as agreed with the driver";
}

// ---- 0188: reconciliation -----------------------------------------------------------------------------------------
// One status per stage, as the database computes it (direct_payment_stage_state). Attached proof never upgrades a
// status; only a Con Z admin's check of a bank or provider record makes a payment "independently confirmed".

export type ReconState =
  | "not_reported"
  | "payment_reported"
  | "receipt_claimed"
  | "both_confirmed"
  | "independently_confirmed"
  | "disputed"
  | "reversal_reported";

export type ReconStage = {
  stage: PaymentStageName;
  state: ReconState;
  evidence: { kind: string; by_role: string; at: string }[];
  evidence_submitted: boolean;
  screenshot_only: boolean;
  flags: string[];
};

export type Reconciliation = {
  agreed_fare: number;
  basis: string;
  stages: ReconStage[];
  totals: {
    agreed: number;
    reported_by_customer: number;
    received_by_driver: number;
    outstanding: number;
    under_review: number;
  };
  /** Only the local stand-in sets this: sample data, never a real record. */
  simulated?: boolean;
};

export function reconStateLabel(s: ReconState): string {
  switch (s) {
    case "not_reported":
      return "Not recorded yet";
    case "payment_reported":
      return "Customer reports paying (not confirmed)";
    case "receipt_claimed":
      return "Driver says received (not checked by Con Z)";
    case "both_confirmed":
      return "Driver and customer agree (not checked by Con Z)";
    case "independently_confirmed":
      return "Checked by Con Z against a bank or provider record";
    case "disputed":
      return "Disputed";
    case "reversal_reported":
      return "Reported as reversed";
  }
}

const FLAG_LABEL: Record<string, string> = {
  customer_amount_differs: "The customer's amount differs from what was agreed.",
  driver_amount_differs: "The driver's amount differs from what was agreed.",
  customer_and_driver_differ: "The customer and the driver recorded different amounts.",
  references_differ: "The customer and the driver gave different payment references.",
  recorded_under_earlier_agreement: "Recorded under an earlier version of the agreement.",
};

export function reconFlagLabels(flags: readonly string[]): string[] {
  return flags.map((f) => FLAG_LABEL[f] ?? f.replace(/_/g, " "));
}

export const PROOF_KINDS = [
  { value: "screenshot", label: "Screenshot (EcoCash/bank message)" },
  { value: "receipt_photo", label: "Photo of a receipt" },
  { value: "bank_statement", label: "Bank statement" },
  { value: "provider_statement", label: "EcoCash/OneMoney/InnBucks statement" },
  { value: "other", label: "Other" },
] as const;

/** One line about attached proof. A screenshot alone is said out loud to be weak. */
export function proofLine(s: Pick<ReconStage, "evidence" | "screenshot_only">): string | null {
  if (!s.evidence.length) return null;
  const n = s.evidence.length;
  const base = `${n} file${n === 1 ? "" : "s"} attached as proof.`;
  return s.screenshot_only ? `${base} Screenshots alone do not confirm a payment.` : base;
}

export function parseReconciliation(raw: unknown): Reconciliation | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Reconciliation).stages))
    return null;
  return raw as Reconciliation;
}
