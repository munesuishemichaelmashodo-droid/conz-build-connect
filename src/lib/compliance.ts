// Driver and vehicle document checks (0191). Every label states one fact an admin checked. Nothing here says
// "fully verified", promises insurance cover, or treats an upload as a check.

export type ComplianceDocType =
  | "identity"
  | "driving_licence"
  | "vehicle_registration"
  | "certificate_of_fitness"
  | "operator_licence"
  | "insurance";

export type ComplianceState = "missing" | "pending" | "checked" | "rejected" | "expired";

export type ComplianceSummaryRow = {
  doc_type: ComplianceDocType;
  truck_id: string | null;
  state: ComplianceState;
  expires_on: string | null;
  licence_class: string | null;
  insurance_type: string | null;
  review_reason: string | null;
};

export type ComplianceBadgeRow = {
  doc_type: ComplianceDocType;
  licence_class: string | null;
  insurance_type: string | null;
  valid_to: string | null;
};

export const DOC_LABEL: Record<ComplianceDocType, string> = {
  identity: "National ID or passport",
  driving_licence: "Driving licence",
  vehicle_registration: "Vehicle registration (ZINARA licence)",
  certificate_of_fitness: "Certificate of Fitness",
  operator_licence: "Operator's licence (if you have one)",
  insurance: "Insurance evidence",
};

export const DOC_ORDER: ComplianceDocType[] = [
  "identity",
  "driving_licence",
  "vehicle_registration",
  "certificate_of_fitness",
  "operator_licence",
  "insurance",
];

export const VEHICLE_DOCS: ComplianceDocType[] = [
  "vehicle_registration",
  "certificate_of_fitness",
  "operator_licence",
  "insurance",
];

export const INSURANCE_TYPES = [
  { value: "goods_in_transit", label: "Goods in transit" },
  { value: "third_party", label: "Third party" },
  { value: "comprehensive", label: "Comprehensive" },
  { value: "other", label: "Other" },
] as const;

export const STATE_LABEL: Record<ComplianceState, string> = {
  missing: "Not submitted",
  pending: "Submitted, waiting for Con Z to check",
  checked: "Checked by Con Z",
  rejected: "Not accepted",
  expired: "Expired",
};

const fmt = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** One badge per checked, unexpired document: what was checked and until when. */
export function badgeLabel(b: ComplianceBadgeRow): string {
  const until = b.valid_to ? `, valid to ${fmt(b.valid_to)}` : "";
  switch (b.doc_type) {
    case "identity":
      return "ID checked";
    case "driving_licence":
      return `Licence checked${b.licence_class ? `, class ${b.licence_class}` : ""}${until}`;
    case "vehicle_registration":
      return `Vehicle registration checked${until}`;
    case "certificate_of_fitness":
      return `Certificate of Fitness checked${until}`;
    case "operator_licence":
      return `Operator's licence checked${until}`;
    case "insurance": {
      const t =
        INSURANCE_TYPES.find((x) => x.value === b.insurance_type)?.label.toLowerCase() ??
        "insurance";
      return `Insurance evidence checked (${t})${until}`;
    }
  }
}

/** The explanation shown next to badges. */
export const BADGE_NOTE =
  "Con Z checked the documents this driver submitted. A check is not a guarantee of insurance cover or of legal compliance.";

export function needsExpiry(t: ComplianceDocType): boolean {
  return t !== "identity";
}
