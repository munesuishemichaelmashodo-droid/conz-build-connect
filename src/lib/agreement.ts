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
  // 0186: what the job was when this version was proposed (copied by the database, never typed) and handling.
  // Missing before 0186; null on versions recorded before it.
  customer_id?: string | null;
  driver_id?: string | null;
  truck_registration?: string | null;
  truck_capacity_m3?: number | null;
  material?: string | null;
  quantity_m3?: number | null;
  pickup_address?: string | null;
  delivery_address?: string | null;
  preferred_date?: string | null;
  agreed_date?: string | null;
  loading_by?: LoadingBy | null;
  offloading_by?: OffloadingBy | null;
  collection_instructions?: string | null;
  content_hash?: string | null;
};

export type LoadingBy = "driver" | "customer" | "collection_point" | "not_needed";
export type OffloadingBy = "driver_tips" | "driver" | "customer" | "not_needed";

export const LOADING_BY: { value: LoadingBy; label: string }[] = [
  { value: "collection_point", label: "Staff at the collection point" },
  { value: "driver", label: "The driver" },
  { value: "customer", label: "The customer" },
  { value: "not_needed", label: "Not needed" },
];

export const OFFLOADING_BY: { value: OffloadingBy; label: string }[] = [
  { value: "driver_tips", label: "The driver tips the load" },
  { value: "driver", label: "The driver offloads by hand" },
  { value: "customer", label: "The customer" },
  { value: "not_needed", label: "Not needed" },
];

const FIELD_LABEL: Record<string, string> = {
  customer_id: "the customer",
  driver_id: "the driver",
  truck_id: "the truck",
  truck_registration: "the truck",
  truck_capacity_m3: "the truck capacity",
  material: "the material",
  quantity_m3: "the quantity",
  pickup_address: "the collection place",
  pickup_lat: "the collection place",
  pickup_lng: "the collection place",
  delivery_address: "the delivery address",
  delivery_lat: "the delivery address",
  delivery_lng: "the delivery address",
  preferred_date: "the date",
  fare: "the fare",
};

/** Plain words for the job details that changed since both agreed (0186 job_agreement_in_force). */
export function changedDetailLabels(fields: readonly string[]): string[] {
  return [...new Set(fields.map((f) => FIELD_LABEL[f] ?? f.replace(/_/g, " ")))];
}

/** The job details recorded with a version (0186). Empty for versions recorded before 0186. */
export function recordedDetails(a: JobAgreement): { label: string; value: string }[] {
  if (!a.content_hash) return [];
  const out: { label: string; value: string }[] = [];
  if (a.quantity_m3 != null || a.material)
    out.push({
      label: "Load",
      value: [
        a.quantity_m3 != null ? `${Number(a.quantity_m3)} m³` : null,
        a.material?.replace(/_/g, " "),
      ]
        .filter(Boolean)
        .join(" of "),
    });
  if (a.truck_registration)
    out.push({
      label: "Truck",
      value:
        a.truck_capacity_m3 != null
          ? `${a.truck_registration} (${Number(a.truck_capacity_m3)} m³)`
          : a.truck_registration,
    });
  if (a.pickup_address) out.push({ label: "Collect from", value: a.pickup_address });
  if (a.delivery_address) out.push({ label: "Deliver to", value: a.delivery_address });
  const date = a.agreed_date ?? a.preferred_date;
  if (date)
    out.push({
      label: "Date",
      value: new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    });
  if (a.loading_by)
    out.push({
      label: "Loading",
      value: LOADING_BY.find((o) => o.value === a.loading_by)?.label ?? a.loading_by,
    });
  if (a.offloading_by)
    out.push({
      label: "Offloading",
      value: OFFLOADING_BY.find((o) => o.value === a.offloading_by)?.label ?? a.offloading_by,
    });
  if (a.collection_instructions)
    out.push({ label: "Collection instructions", value: a.collection_instructions });
  return out;
}

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

/** The payment details a customer relies on to send money. A change in these is how money gets redirected. */
const PAYMENT_DETAIL_FIELDS = [
  ["recipient_name", "who to pay"],
  ["recipient_account", "the number or account to pay"],
  ["payment_instructions", "the payment instructions"],
] as const;

/**
 * When a proposal is waiting for an answer and an earlier version was accepted, which payment details it changes
 * (recipient, account, instructions, method). Empty when nothing was accepted before or nothing payment-related changed.
 */
export function paymentDetailChanges(rows: JobAgreement[] | null | undefined): string[] {
  const list = [...(rows ?? [])].sort((a, b) => b.version - a.version);
  const proposed = list.find((r) => r.status === "proposed");
  if (!proposed) return [];
  const accepted = list.find((r) => r.status === "accepted" && r.version < proposed.version);
  if (!accepted) return [];
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : (v ?? null)) || null;
  const changes: string[] = PAYMENT_DETAIL_FIELDS.filter(
    ([k]) => norm(proposed[k]) !== norm(accepted[k]),
  ).map(([, label]) => label);
  if (agreedMethod(proposed) !== agreedMethod(accepted)) changes.push("the payment method");
  return changes;
}
