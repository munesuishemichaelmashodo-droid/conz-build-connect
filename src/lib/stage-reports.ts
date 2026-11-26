// Wording and rules for job stage reports (0187). Reports are statements by the customer or the driver; they are never
// shown as verified facts.

export type StageEvent =
  "collection_confirmed" | "collection_problem" | "delay" | "delivery_problem";

export type StageReport = {
  id: string;
  job_id: string;
  reported_by: string;
  reporter_role: "customer" | "driver";
  event: StageEvent;
  issue: string | null;
  condition: string | null;
  quantity_m3: number | null;
  eta_minutes: number | null;
  note: string | null;
  evidence_id: string | null;
  corrects_report: string | null;
  created_at: string;
};

export const COLLECTION_PROBLEMS = [
  { value: "quantity_short", label: "Less material than agreed" },
  { value: "wrong_material", label: "Wrong material" },
  { value: "poor_quality", label: "Poor quality" },
  { value: "site_closed", label: "Collection point closed" },
  { value: "not_ready", label: "Load not ready" },
  { value: "other", label: "Something else" },
] as const;

export const DELAY_REASONS = [
  { value: "traffic", label: "Traffic" },
  { value: "breakdown", label: "Breakdown" },
  { value: "fuel", label: "Fuel" },
  { value: "weather", label: "Weather" },
  { value: "road_block", label: "Road block" },
  { value: "other", label: "Something else" },
] as const;

export const DELIVERY_PROBLEMS = [
  { value: "shortage", label: "Less than agreed arrived" },
  { value: "partial_delivery", label: "Only part was delivered" },
  { value: "damage", label: "Damaged or spoilt" },
  { value: "wrong_material", label: "Wrong material" },
  { value: "wrong_place", label: "Delivered to the wrong place" },
  { value: "other", label: "Something else" },
] as const;

export const CONDITIONS = [
  { value: "as_agreed", label: "As agreed" },
  { value: "wet", label: "Wet" },
  { value: "mixed", label: "Mixed with other material" },
  { value: "contaminated", label: "Has rubbish or soil in it" },
  { value: "other", label: "Other (describe)" },
] as const;

const ALL = [...COLLECTION_PROBLEMS, ...DELAY_REASONS, ...DELIVERY_PROBLEMS, ...CONDITIONS];
const label = (v: string | null) =>
  v ? (ALL.find((o) => o.value === v)?.label ?? v.replace(/_/g, " ")) : null;

export const EVENT_TITLE: Record<StageEvent, string> = {
  collection_confirmed: "Collection confirmed",
  collection_problem: "Problem at collection",
  delay: "Delay",
  delivery_problem: "Problem with the delivery",
};

/** One line describing a report, in plain words. Always attributed: "Driver reports …". */
export function reportLine(r: StageReport): string {
  const who = r.reporter_role === "driver" ? "Driver" : "Customer";
  const q = r.quantity_m3 != null ? `${Number(r.quantity_m3)} m³` : null;
  switch (r.event) {
    case "collection_confirmed":
      return `${who} reports ${q ?? "a load"} loaded, condition: ${label(r.condition)?.toLowerCase() ?? "not given"}.`;
    case "collection_problem":
      return `${who} reports at collection: ${label(r.issue)?.toLowerCase()}${q ? ` (${q})` : ""}.`;
    case "delay":
      return `${who} reports a delay (${label(r.issue)?.toLowerCase()}), new arrival in about ${r.eta_minutes} minutes.`;
    case "delivery_problem":
      return `${who} reports: ${label(r.issue)?.toLowerCase()}${q ? `, ${q} received` : ""}.`;
  }
}

/** Which report buttons a person sees. Mirrors report_job_stage's rules; the database still decides. */
export function availableReports(
  role: "customer" | "driver" | null,
  status: string,
  hasPickupPhoto: boolean,
  completedAt: string | null,
  now = Date.now(),
): StageEvent[] {
  if (role === "driver" && (status === "accepted" || status === "in_progress")) {
    const out: StageEvent[] = [];
    if (hasPickupPhoto) out.push("collection_confirmed");
    out.push("collection_problem", "delay");
    return out;
  }
  const recent = !!completedAt && now - new Date(completedAt).getTime() < 7 * 24 * 3600 * 1000;
  if (status === "in_progress" || (status === "completed" && recent)) return ["delivery_problem"];
  return [];
}
