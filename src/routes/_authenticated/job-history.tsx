import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { History, Search as SearchIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import {
  filterHistory,
  rowDate,
  splitHistory,
  type HistoryFilter,
  type HistoryRow,
} from "@/lib/job-history";

export const Route = createFileRoute("/_authenticated/job-history")({
  component: JobHistory,
});

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const PAGE = 100;

const material = (r: HistoryRow) =>
  `${(r.custom_material || r.material || "Job").replace(/_/g, " ")}${r.quantity_m3 ? ` · ${Number(r.quantity_m3)} m³` : ""}`;

function HistoryItem({ r }: { r: HistoryRow }) {
  const date = rowDate(r);
  return (
    <li>
      <Link
        to="/jobs/$id"
        params={{ id: r.id }}
        className="block rounded-xl border bg-card p-3 active:opacity-70"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold capitalize">{material(r)}</p>
          <StatusBadge
            label={r.status === "completed" ? "Completed" : "Cancelled"}
            className={
              r.status === "completed"
                ? "bg-success/15 text-success border-success/30"
                : "bg-muted text-muted-foreground border-transparent"
            }
          />
        </div>
        <p className="truncate text-xs text-muted-foreground">{r.delivery_address ?? "—"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {date ? new Date(date).toLocaleDateString("en-GB", { timeZone: "Africa/Harare" }) : ""}
          {r.status === "completed" && r.net_earned != null
            ? ` · earned $${Number(r.net_earned).toFixed(2)}`
            : ""}
          {r.status === "cancelled" && r.cancellation_reason ? ` · ${r.cancellation_reason}` : ""}
        </p>
      </Link>
    </li>
  );
}

function JobHistory() {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [q, setQ] = useState("");
  const [pages, setPages] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-job-history", pages],
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data: rows, error } = await (supabase.rpc as unknown as Rpc)("driver_job_history", {
        _limit: PAGE * pages,
        _offset: 0,
      });
      if (error) throw new Error(error.message);
      return (rows ?? []) as HistoryRow[];
    },
  });

  const all = data ?? [];
  const { recent, archived } = splitHistory(filterHistory(all, filter, q));

  return (
    <AppShell title="Job history">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["all", "completed", "cancelled"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f ? "bg-primary text-primary-foreground border-transparent" : "bg-card text-muted-foreground"}`}
            >
              {f === "all" ? "All" : f === "completed" ? "Completed" : "Cancelled"}
            </button>
          ))}
        </div>
        <label className="relative block">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search material, area or customer"
            aria-label="Search job history"
            className="w-full rounded-xl border bg-card py-2.5 pl-9 pr-3 text-sm"
          />
        </label>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : recent.length + archived.length === 0 ? (
          <EmptyState
            icon={History}
            title="No jobs here"
            hint="Finished jobs appear here. Active jobs stay on your home screen."
          />
        ) : (
          <>
            {recent.length > 0 && (
              <section aria-label="Last 30 days" className="space-y-2">
                <h2 className="text-sm font-semibold">Last 30 days</h2>
                <ul className="space-y-2">
                  {recent.map((r) => (
                    <HistoryItem key={r.id} r={r} />
                  ))}
                </ul>
              </section>
            )}
            {archived.length > 0 && (
              <details className="rounded-xl border bg-card" open={!!q.trim()}>
                <summary className="cursor-pointer px-3 py-3 text-sm font-semibold">
                  Archived ({archived.length}) · older than 30 days
                </summary>
                <ul className="space-y-2 p-3 pt-0">
                  {archived.map((r) => (
                    <HistoryItem key={r.id} r={r} />
                  ))}
                </ul>
              </details>
            )}
            {all.length >= PAGE * pages && (
              <button
                type="button"
                onClick={() => setPages((p) => p + 1)}
                className="w-full rounded-xl border py-2.5 text-sm font-semibold"
              >
                Load older jobs
              </button>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Older jobs are archived here, never deleted. Payments, delivery proof and disputes are
          kept.
        </p>
      </div>
    </AppShell>
  );
}
