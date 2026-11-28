// Report categories (0178). Safety, fraud and harassment reports are marked urgent by the database and every admin
// is notified at once. ConZ does not run an emergency response: the report screen tells people to call the
// emergency services first when anyone is in danger.

export const REPORT_CATEGORIES = [
  "accident_injury",
  "safety",
  "threats",
  "theft_missing",
  "damage_shortage",
  "no_show",
  "false_delivery",
  "unsafe_cargo",
  "account_compromise",
  "data_exposure",
  "platform_outage",
  "fraud_scam",
  "harassment",
  "payment",
  "off_platform_request",
  "suspicious_job",
  "general",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

const LABEL: Record<ReportCategory, string> = {
  accident_injury: "Accident or injury",
  threats: "Threats or assault",
  theft_missing: "Theft, robbery or missing cargo",
  damage_shortage: "Damaged, short or partly delivered materials",
  no_show: "Driver did not come or left the job",
  false_delivery: "Delivery or collection marked done that did not happen",
  unsafe_cargo: "Unsafe or prohibited cargo",
  account_compromise: "Someone got into my account",
  data_exposure: "My personal information was exposed",
  platform_outage: "The app is not working",
  safety: "Safety: someone was hurt, threatened or put at risk",
  fraud_scam: "Fraud or scam: fake payment, fake driver, someone asking for money",
  harassment: "Harassment or abuse",
  payment: "Payment problem with the driver or customer",
  off_platform_request: "Someone asked me to deal outside Con Z",
  suspicious_job: "Suspicious job or offer",
  general: "Something else",
};

export function reportCategoryLabel(c: unknown): string {
  return typeof c === "string" && c in LABEL ? LABEL[c as ReportCategory] : LABEL.general;
}

export function isReportCategory(c: unknown): c is ReportCategory {
  return typeof c === "string" && (REPORT_CATEGORIES as readonly string[]).includes(c);
}

const URGENT = new Set([
  "safety",
  "fraud_scam",
  "harassment",
  "accident_injury",
  "theft_missing",
  "threats",
  "account_compromise",
  "data_exposure",
  "unsafe_cargo",
]);

/** The same rule the database applies (tg_reports_urgent_notify, 0178/0192). */
export function isUrgentCategory(c: unknown): boolean {
  return typeof c === "string" && URGENT.has(c);
}

/** Physical-safety categories: the report screen puts the emergency numbers first. */
export function isPhysicalSafety(c: unknown): boolean {
  return c === "accident_injury" || c === "safety" || c === "threats" || c === "unsafe_cargo";
}

export const CASE_STATUS_LABEL: Record<string, string> = {
  reported: "Received",
  investigating: "Being looked into",
  decided: "Decided (you can appeal within 14 days)",
  appealed: "Appeal being reviewed by a different person",
  closed: "Closed",
};
