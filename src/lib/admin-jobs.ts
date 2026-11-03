// Pure helpers for the admin Jobs list so the filtering rules can be unit-tested.

export const ADMIN_JOB_FILTERS = ["active", "open", "completed", "cancelled", "all"] as const;
export type AdminJobFilter = (typeof ADMIN_JOB_FILTERS)[number];

export const ADMIN_JOB_FILTER_LABEL: Record<AdminJobFilter, string> = {
  active: "In progress",
  open: "Open",
  completed: "Completed",
  cancelled: "Cancelled",
  all: "All",
};

/** Statuses a filter covers. `null` means no status restriction. */
export function statusesFor(filter: AdminJobFilter): string[] | null {
  switch (filter) {
    case "active":
      return ["accepted", "in_progress"];
    case "open":
      return ["open"];
    case "completed":
      return ["completed"];
    case "cancelled":
      return ["cancelled"];
    default:
      return null;
  }
}

export interface AdminJobRow {
  id: string;
  status: string;
  material: string | null;
  custom_material: string | null;
  quantity_m3: number | null;
  delivery_address: string | null;
  final_price: number | null;
  budget: number | null;
  payment_method: string | null;
  created_at: string;
  updated_at: string | null;
  customerName: string;
  driverName: string;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** Case-insensitive match on id, material, address, customer and driver. */
export function matchesSearch(row: AdminJobRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [row.id, row.material, row.custom_material, row.delivery_address, row.customerName, row.driverName]
    .map(norm)
    .some((v) => v.includes(needle));
}

export function jobTitle(row: Pick<AdminJobRow, "material" | "custom_material" | "quantity_m3">): string {
  const name = (row.custom_material || row.material || "Job").replace(/_/g, " ");
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return row.quantity_m3 ? `${label} · ${Number(row.quantity_m3)} m³` : label;
}
