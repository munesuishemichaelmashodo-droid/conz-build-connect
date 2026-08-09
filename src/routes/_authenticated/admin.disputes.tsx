import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Gavel, XCircle, Search as SearchIcon, RefreshCcw, ShieldOff, AlertTriangle, Check, Ban } from "lucide-react";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { DisputeEvidence } from "@/components/DisputeEvidence";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/disputes")({
  component: AdminDisputes,
});

type Filter = "open" | "investigating" | "resolved" | "rejected";

const CATEGORY_LABEL: Record<string, string> = {
  wrong_quantity: "Wrong quantity",
  damage: "Damaged material",
  no_show: "Driver no-show",
  payment_issue: "Payment issue",
  conduct: "Bad conduct",
  other: "Other",
};

const OUTCOMES: { value: string; label: string; icon: typeof Check; className: string }[] = [
  { value: "refund", label: "Refund customer", icon: RefreshCcw, className: "bg-success text-success-foreground" },
  { value: "fee_waived", label: "Waive commission", icon: Check, className: "bg-primary text-primary-foreground" },
  { value: "strike_issued", label: "Issue strike", icon: AlertTriangle, className: "border bg-warning/15 text-warning border-warning/30" },
  { value: "no_action", label: "No action", icon: XCircle, className: "border bg-muted text-muted-foreground" },
  { value: "account_suspended", label: "Suspend account", icon: ShieldOff, className: "bg-destructive text-destructive-foreground" },
];

function AdminDisputes() {
  const [filter, setFilter] = useState<Filter>("open");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-disputes", filter],
    queryFn: async () => {
      const { data: disputes } = await supabase
        .from("disputes")
        .select("id,job_id,raised_by,against,reason,category,status,outcome,resolution,created_at,resolved_at")
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

  const setInvestigating = async (id: string) => {
    const { error } = await supabase.from("disputes").update({ status: "investigating" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Marked as investigating");
    qc.invalidateQueries({ queryKey: ["admin-disputes"] });
  };

  const reject = async (id: string) => {
    const resolution = window.prompt("Why is this dispute being rejected? (e.g. no evidence, spam)") ?? "";
    if (!resolution.trim()) return;
    const { error } = await supabase
      .from("disputes")
      .update({ status: "rejected", resolution, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Dispute rejected");
    qc.invalidateQueries({ queryKey: ["admin-disputes"] });
  };

  const applyOutcome = async (id: string, outcome: string, label: string) => {
    const resolution = window.prompt(`Resolution notes for "${label}" (sent to both parties):`) ?? "";
    if (!resolution.trim()) return;
    if (!window.confirm(`Confirm: ${label}? This applies real effects (refund/strike/suspension) immediately and can't be undone from here.`)) return;
    const { error } = await supabase.rpc("resolve_dispute", {
      _dispute_id: id,
      _outcome: outcome,
      _resolution: resolution,
    });
    if (error) return toast.error(error.message);
    toast.success(`Resolved — ${label}`);
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
                <div className="flex flex-col items-end gap-1">
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
                  {d.category && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {CATEGORY_LABEL[d.category] ?? d.category}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm">{d.reason}</p>
              {d.outcome && (
                <p className="text-[11px] font-semibold text-foreground">
                  Outcome: {OUTCOMES.find((o) => o.value === d.outcome)?.label ?? d.outcome}
                </p>
              )}
              {d.resolution && (
                <p className="text-xs italic text-muted-foreground border-l-2 border-primary/50 pl-2">{d.resolution}</p>
              )}

              <DisputeEvidence jobId={d.job_id} />

              {(filter === "open" || filter === "investigating") && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    {filter === "open" && (
                      <button
                        onClick={() => setInvestigating(d.id)}
                        className="rounded-lg border py-2 text-xs font-semibold hover:bg-warning/10"
                      >
                        <SearchIcon className="w-3.5 h-3.5 inline mr-1" /> Investigate
                      </button>
                    )}
                    <button
                      onClick={() => reject(d.id)}
                      className={`rounded-lg border py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 ${filter === "investigating" ? "col-span-2" : ""}`}
                    >
                      <Ban className="w-3.5 h-3.5 inline mr-1" /> Reject (no merit)
                    </button>
                  </div>

                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground pt-1">Resolve with outcome</div>
                  <div className="grid grid-cols-2 gap-2">
                    {OUTCOMES.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => applyOutcome(d.id, o.value, o.label)}
                        className={`rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-1 ${o.className}`}
                      >
                        <o.icon className="w-3.5 h-3.5" /> {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
