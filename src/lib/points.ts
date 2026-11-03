// ConZ points display helpers (0131). Pure so the wording can be unit-tested.

export interface PointsEntry {
  id: string;
  points: number;
  kind: "award" | "adjustment" | "reversal";
  event: "delivery" | "referral" | null;
  reason: string | null;
  basis: { material?: string | null; quantity_m3?: number | null } | null;
  created_at: string;
}

const MATERIAL = (m?: string | null) => (m ? m.replace(/_/g, " ") : "");

/** One plain-language line saying why the points moved. */
export function pointsReason(e: PointsEntry): string {
  if (e.kind === "adjustment") return `Adjustment by ConZ: ${e.reason ?? "no reason recorded"}`;
  if (e.kind === "reversal") return `Reversed by ConZ: ${e.reason ?? "no reason recorded"}`;
  if (e.event === "referral") return "A person you referred qualified";
  const m = MATERIAL(e.basis?.material);
  const q = e.basis?.quantity_m3 ? `${Number(e.basis.quantity_m3)} m³ ` : "";
  return m ? `Verified delivery: ${q}${m}` : "Verified delivery";
}

export function formatPoints(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}`;
}
