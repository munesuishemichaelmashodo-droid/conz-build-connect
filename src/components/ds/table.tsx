import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortRows, type SortDir, type SortValue } from "@/lib/sort-rows";

/**
 * Client-side sorting for rows a screen has already loaded. It reorders what is
 * on screen only; it never changes which rows are fetched.
 */
export function useSortedRows<T, K extends string>(
  rows: T[],
  getters: Record<K, (row: T) => SortValue>,
  initial: { key: K; dir: SortDir } | null = null,
) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(
    () => (sort ? sortRows(rows, getters[sort.key], sort.dir) : rows),
    // getters is a static map defined by the caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort],
  );
  const toggle = (key: K) =>
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  return { sorted, sort, toggle };
}

/** A column header that sorts its column. Announces the current order. */
export function SortHeader({
  children,
  active,
  dir,
  onSort,
  align = "left",
  className,
}: {
  children: ReactNode;
  active: boolean;
  dir: SortDir | undefined;
  onSort: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm text-cz-text hover:bg-cz-surface-2",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        <Icon
          aria-hidden
          className={cn("h-3.5 w-3.5", active ? "text-cz-text" : "text-cz-muted")}
        />
      </button>
    </th>
  );
}

/** Plain column header (not sortable). */
export function Th({
  children,
  align = "left",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-sm font-semibold text-cz-text",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** Table frame shared by admin lists on wide screens. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-cz-border bg-cz-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
