import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Briefcase, Search as SearchIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { formatAge } from "@/lib/admin-attention";
import {
  ADMIN_JOB_FILTERS,
  ADMIN_JOB_FILTER_LABEL,
  jobTitle,
  matchesSearch,
  statusesFor,
  type AdminJobFilter,
  type AdminJobRow,
} from "@/lib/admin-jobs";

export const Route = createFileRoute("/_authenticated/admin/jobs")({
  component: AdminJobs,
});

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  accepted: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
const STATUS_CLASS: Record<string, string> = {
  open: "bg-cz-info-tint text-cz-info-text border-transparent",
  accepted: "bg-warning/15 text-warning border-warning/30",
  in_progress: "bg-warning/15 text-warning border-warning/30",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-muted text-muted-foreground border-transparent",
};
const LIMIT = 200;

function AdminJobs() {
  const [filter, setFilter] = useState<AdminJobFilter>("active");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-jobs", filter],
    queryFn: async (): Promise<AdminJobRow[]> => {
      let query = supabase
        .from("jobs")
        .select("id,status,material,custom_material,quantity_m3,delivery_address,final_price,budget,payment_method,created_at,updated_at,customer_id,driver_id")
        .order("updated_at", { ascending: filter === "active" })
        .limit(LIMIT);
      const statuses = statusesFor(filter);
      if (statuses) query = query.in("status", statuses as never);
      const { data: jobs } = await query;
      const ids = Array.from(new Set((jobs ?? []).flatMap((j) => [j.customer_id, j.driver_id].filter(Boolean) as string[])));
      const { data: profiles } = ids.length
        ? await supabase.from("profiles").select("id,full_name").in("id", ids)
        : { data: [] as { id: string; full_name: string | null }[] };
      const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? ""]));
      return (jobs ?? []).map((j) => ({
        id: j.id,
        status: j.status,
        material: j.material,
        custom_material: j.custom_material,
        quantity_m3: j.quantity_m3,
        delivery_address: j.delivery_address,
        final_price: j.final_price,
        budget: j.budget,
        payment_method: j.payment_method,
        created_at: j.created_at,
        updated_at: j.updated_at,
        customerName: names.get(j.customer_id) || "Customer",
        driverName: j.driver_id ? names.get(j.driver_id) || "Driver" : "",
      }));
    },
  });

  const rows = (data ?? []).filter((r) => matchesSearch(r, q));
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ADMIN_JOB_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === f ? "bg-primary text-primary-foreground border-transparent" : "bg-card text-muted-foreground"}`}
          >
            {ADMIN_JOB_FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      <label className="relative block">
        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search material, address, name or job id"
          className="w-full rounded-xl border bg-card py-2.5 pl-9 pr-3 text-sm"
          aria-label="Search jobs"
        />
      </label>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading jobs…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs match" hint="Try another filter or search." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const age = now - new Date(r.updated_at ?? r.created_at).getTime();
            return (
              <li key={r.id}>
                <Link to="/jobs/$id" params={{ id: r.id }} className="block rounded-2xl border bg-card p-3 shadow-card active:opacity-70">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{jobTitle(r)}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.delivery_address ?? "No address"}</p>
                    </div>
                    <StatusBadge label={STATUS_LABEL[r.status] ?? r.status} className={STATUS_CLASS[r.status]} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.customerName}
                    {r.driverName ? ` → ${r.driverName}` : " · no driver yet"}
                    {" · "}
                    {r.payment_method === "escrow" ? "Con Z Pay" : "Pays driver directly"}
                    {" · $"}
                    {Number(r.final_price ?? r.budget ?? 0).toFixed(2)}
                    {" · updated "}
                    {formatAge(age)} ago
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(data?.length ?? 0) >= LIMIT && <p className="text-xs text-muted-foreground">Showing the latest {LIMIT}. Use search or a filter to narrow it.</p>}
    </div>
  );
}
