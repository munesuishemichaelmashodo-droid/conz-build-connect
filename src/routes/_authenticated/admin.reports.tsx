import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { MessageSquareWarning, ShieldAlert, Phone, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  component: AdminReports,
});

type Filter = "open" | "resolved" | "all";

function AdminReports() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");

  const { data: flags } = useQuery({
    queryKey: ["admin-chat-flags"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("chat_flags")
        .select("job_id,pattern_type,snippet,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (!rows?.length) return [];
      // Group by job — a job with 2+ flags is the real signal.
      const byJob = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = byJob.get(r.job_id) ?? [];
        list.push(r);
        byJob.set(r.job_id, list);
      }
      return Array.from(byJob.entries())
        .filter(([, list]) => list.length >= 2)
        .map(([job_id, list]) => ({ job_id, count: list.length, latest: list[0] }));
    },
  });

  const { data } = useQuery({
    queryKey: ["admin-reports", filter],
    queryFn: async () => {
      let q = supabase.from("reports").select("*").order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data: rows } = await q;
      const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
      const { data: profs } = userIds.length
        ? await supabase.from("profiles").select("id,full_name,email,phone").in("id", userIds)
        : { data: [] };
      const pmap = new Map((profs ?? []).map((p) => [p.id, p]));
      return (rows ?? []).map((r) => ({ ...r, profile: pmap.get(r.user_id) }));
    },
  });

  const update = async (id: string, patch: { status?: string; admin_notes?: string }) => {
    const { error } = await supabase.from("reports").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Report updated");
    qc.invalidateQueries({ queryKey: ["admin-reports"] });
  };

  return (
    <div className="space-y-3">
      {/* Off-platform contact alert — auto-detected, surfaced above the
          filter/list below since it needs no user report to be actionable */}
      {!!flags?.length && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-warning uppercase tracking-wide">
            <ShieldAlert className="w-4 h-4" /> Possible off-platform contact ({flags.length})
          </div>
          {flags.map((f) => (
            <Link
              key={f.job_id}
              to="/jobs/$id"
              params={{ id: f.job_id }}
              className="block rounded-lg bg-card border p-2 text-xs hover:bg-muted"
            >
              <div className="flex justify-between">
                <span className="font-mono text-[11px]">Job {f.job_id.slice(0, 8)}</span>
                <span className="text-muted-foreground">{f.count} flagged messages</span>
              </div>
              {f.latest.snippet && <p className="text-muted-foreground italic mt-1 truncate">"{f.latest.snippet}"</p>}
            </Link>
          ))}
        </div>
      )}

      {/* Status filter — defaults to "open" */}
      <div className="flex gap-2">
        {(["open", "resolved", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-lg border py-2 text-xs font-semibold uppercase ${
              filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* User-submitted reports */}
      {!data?.length ? (
        <EmptyState icon={MessageSquareWarning} title={`No ${filter} reports`} hint="User-submitted reports will appear here." />
      ) : (
        <div className="space-y-3">
          {data.map((r) => <ReportCard key={r.id} r={r} onUpdate={update} />)}
        </div>
      )}
    </div>
  );
}

function ReportCard({ r, onUpdate }: { r: any; onUpdate: (id: string, patch: { status?: string; admin_notes?: string }) => void }) {
  const [note, setNote] = useState(r.admin_notes ?? "");
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      {/* Reporter identity + contact */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{r.profile?.full_name ?? "Unknown user"}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
            {r.profile?.phone && (
              <a href={`tel:${r.profile.phone}`} className="text-xs text-primary font-semibold flex items-center gap-1">
                <Phone className="w-3 h-3" /> {r.profile.phone}
              </a>
            )}
            {r.profile?.email && (
              <a href={`mailto:${r.profile.email}`} className="text-xs text-primary font-semibold flex items-center gap-1 truncate">
                <Mail className="w-3 h-3 shrink-0" /> {r.profile.email}
              </a>
            )}
          </div>
        </div>
        <StatusBadge
          label={r.status}
          className={r.status === "resolved" ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}
        />
      </div>

      {/* Report details */}
      <p className="text-sm whitespace-pre-wrap">{r.description}</p>
      {r.job_id && <p className="text-[11px] text-muted-foreground">Related job: <code>{r.job_id}</code></p>}
      <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>

      {/* Admin note + resolve/reopen */}
      <div className="space-y-2 pt-2 border-t">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Admin reply / internal note…" rows={2} />
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" onClick={() => onUpdate(r.id, { admin_notes: note })}>Save note</Button>
          {r.status === "open" ? (
            <Button size="sm" onClick={() => onUpdate(r.id, { status: "resolved", admin_notes: note })}>Mark resolved</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => onUpdate(r.id, { status: "open", admin_notes: note })}>Reopen</Button>
          )}
        </div>
      </div>
    </div>
  );
}
