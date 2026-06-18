import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Gavel, CheckCircle2, XCircle, Search as SearchIcon } from "lucide-react";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/disputes")({
  component: AdminDisputes;
});

type Filter = "open" | "investigating" | "resolved" | "rejected";

function AdminDisputes() {
  const [filter, setFilter] = useState<Filter>("open");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-disputes", filter],
    queryFn: async () => {
      const { data: disputes } = await supabase
        .from("disputes")
        .select("id,job_id,raised_by,against,reason,status,resolution,created_at,resolved_at")
        .eq("status", filter)
        .order("created_at", { ascending: false });
      const userIds = Array.from(
        new Set((disputes ?? []).flatMap((d) => [d.raised_by, d.against].filter(Boolean) as string[])),
      );
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id,full_name").in("id", userIds)
        : { data: [] as { id: string; full_name: string }[] };
      const pmap = new Map(profiles?.map((p) => [p.id, p.full_name]) ?? []);
      return (disputes ?? []).map((d) => ({
        ...d,
        raised_by_name: pmap.get(d.raised_by) ?? "—",
        against_name: d.against ? (pmap.get(d.against) ?? "—") : "—",
      }));
    },
  });

  const resolve = async (id: string, status: "resolved" | "rejected" | "investigating") => {
    let resolution: string | null = null;
    if (status !== "investigating") {
      resolution = window.prompt("Resolution notes") ?? "";
    }
    const { error } = await supabase
      .from("disputes")
      .update({
        status,
        resolution,
        resolved_at: status === "investigating" ? null : new Date().toISOString(),
      })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Dispute updated");
    qc.invalidateQueries({ queryKey: ["admin-disputes"] });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {(["open", "investigating", "resolved", "rejected"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg border py-2 text-[11px] font-semibold uppercase ${
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {!data?.length ? (
        <EmptyState icon={Gavel} title={`No ${filter} disputes`} />
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <div key={d.id} className="rounded-xl border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs">
                  <div className="font-semibold">{d.raised_by_name} <span className="text-muted-foreground">vs</span> {d.against_name}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Job {d.job_id.slice(0, 8)} · {new Date(d.created_at).toLocaleString()}</div>
                </div>
                <StatusBadge
                  label={d.status}
                  className={
                    d.status === "open" || d.status === "investigating"
                      ? "bg-warning/15 text-warning border-warning/30"
                      : d.status === "resolved"
                        ? "bg-success/15 text-success border-success/30"
                        : "bg-muted text-muted-foreground border-border"
                  }
                />
              </div>
              <p className="text-sm">{d.reason}</p>
              {d.resolution && (
                <p className="text-xs italic text-muted-foreground border-l-2 border-primary/50 pl-2">{d.resolution}</p>
              )}
              {(filter === "open" || filter === "investigating") && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {filter === "open" && (
                    <button
                      onClick={() => resolve(d.id, "investigating")}
                      className="rounded-lg border py-2 text-xs font-semibold hover:bg-warning/10"
                    >
                      <SearchIcon className="w-3.5 h-3.5 inline mr-1" /> Investigate
                    </button>
                  )}
                  <button
                    onClick={() => resolve(d.id, "resolved")}
                    className={`rounded-lg bg-success text-success-foreground font-semibold py-2 text-xs ${filter === "open" ? "" : "col-span-2"}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" /> Resolve
                  </button>
                  <button
                    onClick={() => resolve(d.id, "rejected")}
                    className="rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-xs"
                  >
                    <XCircle className="w-3.5 h-3.5 inline mr-1" /> Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
