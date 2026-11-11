// Driver job history: recent (30 days) vs archived, search and filters. Pure so the rules can be tested.
// Nothing here changes a job; "archived" only means older than the recent window. Times are server timestamps.

export const RECENT_DAYS = 30;

export interface HistoryRow {
  id: string;
  status: string;
  material: string | null;
  custom_material: string | null;
  quantity_m3: number | null;
  final_price: number | null;
  net_earned: number | null;
  delivery_address: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  customer_name: string | null;
}

export type HistoryFilter = "all" | "completed" | "cancelled";

export const rowDate = (r: Pick<HistoryRow, "completed_at" | "cancelled_at">): string | null =>
  r.completed_at ?? r.cancelled_at;

export function isRecent(
  r: Pick<HistoryRow, "completed_at" | "cancelled_at">,
  now: Date = new Date(),
): boolean {
  const d = rowDate(r);
  if (!d) return true;
  return now.getTime() - new Date(d).getTime() <= RECENT_DAYS * 24 * 3_600_000;
}

export function filterHistory(
  rows: HistoryRow[],
  filter: HistoryFilter,
  query: string,
): HistoryRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!q) return true;
    return [
      r.material,
      r.custom_material,
      r.delivery_address,
      r.customer_name,
      r.cancellation_reason,
      r.id,
    ]
      .map((v) => (v ?? "").toLowerCase().replace(/_/g, " "))
      .some((v) => v.includes(q));
  });
}

export function splitHistory(
  rows: HistoryRow[],
  now: Date = new Date(),
): { recent: HistoryRow[]; archived: HistoryRow[] } {
  return {
    recent: rows.filter((r) => isRecent(r, now)),
    archived: rows.filter((r) => !isRecent(r, now)),
  };
}
