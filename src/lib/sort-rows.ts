export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined;

/**
 * Stable sort of already-loaded rows. Empty values always go last, text compares
 * case-insensitively and numbers numerically. Returns a new array.
 */
export function sortRows<T>(rows: T[], get: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      const ae = a.v == null || a.v === "";
      const be = b.v == null || b.v === "";
      if (ae || be) return ae && be ? a.i - b.i : ae ? 1 : -1;
      const c =
        typeof a.v === "number" && typeof b.v === "number"
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v), undefined, {
              sensitivity: "base",
              numeric: true,
            });
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((x) => x.row);
}
