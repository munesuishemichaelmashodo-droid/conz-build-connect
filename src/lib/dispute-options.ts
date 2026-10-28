// What each side can report. The customer and the driver see different problems; each option
// is stored under one of the database's dispute categories, and its wording goes into the
// reason so admins see exactly what was chosen.

export type DisputeCategory =
  "wrong_quantity" | "damage" | "no_show" | "payment_issue" | "conduct" | "other";

export type DisputeSide = "customer" | "driver";

export type DisputeOption = { id: string; category: DisputeCategory; label: string };

export const DISPUTE_OPTIONS: Record<DisputeSide, DisputeOption[]> = {
  customer: [
    { id: "short_load", category: "wrong_quantity", label: "Less material than I paid for" },
    { id: "wrong_material", category: "damage", label: "Wrong or poor-quality material" },
    { id: "driver_no_show", category: "no_show", label: "Driver didn't arrive" },
    { id: "wrong_place", category: "other", label: "Tipped in the wrong place" },
    { id: "property_damage", category: "damage", label: "Damage to my property" },
    { id: "customer_payment", category: "payment_issue", label: "Payment problem" },
    { id: "driver_conduct", category: "conduct", label: "Driver's behaviour" },
    { id: "customer_other", category: "other", label: "Something else" },
  ],
  driver: [
    { id: "customer_absent", category: "no_show", label: "Customer not there to receive the load" },
    { id: "pin_refused", category: "payment_issue", label: "Customer won't give the delivery PIN" },
    { id: "not_paid", category: "payment_issue", label: "Customer won't pay or paid less" },
    { id: "site_access", category: "other", label: "Site unsafe or truck can't get in" },
    { id: "job_changed", category: "other", label: "Customer changed the job (address or load)" },
    { id: "customer_conduct", category: "conduct", label: "Customer's behaviour" },
    { id: "driver_other", category: "other", label: "Something else" },
  ],
};

export function disputeOption(side: DisputeSide, id: string): DisputeOption | null {
  return DISPUTE_OPTIONS[side].find((o) => o.id === id) ?? null;
}

/** The reason text saved with the dispute: the chosen problem, then the person's words. */
export function disputeReason(option: DisputeOption, explanation: string): string {
  return `${option.label}: ${explanation.trim()}`;
}

/** The database asks for at least 10 characters of explanation. */
export const MIN_DISPUTE_EXPLANATION = 10;
