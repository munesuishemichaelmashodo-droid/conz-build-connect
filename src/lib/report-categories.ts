// Report categories (0178). Safety, fraud and harassment reports are marked urgent by the database and every admin
// is notified at once. ConZ does not run an emergency response: the report screen tells people to call the
// emergency services first when anyone is in danger.

export const REPORT_CATEGORIES = [
  "safety",
  "fraud_scam",
  "harassment",
  "payment",
  "off_platform_request",
  "suspicious_job",
  "general",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

const LABEL: Record<ReportCategory, string> = {
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

/** The same rule the database applies (tg_reports_urgent_notify). */
export function isUrgentCategory(c: unknown): boolean {
  return c === "safety" || c === "fraud_scam" || c === "harassment";
}
