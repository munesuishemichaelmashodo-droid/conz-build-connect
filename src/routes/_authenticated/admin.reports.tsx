import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  component: AdminReports,
});

type Filter = "open" | "resolved" | "all";

function AdminReports() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");

  const { data } = useQuery({
    queryKey: ["admin-reports", filter],
    queryFn: async () => {
      let q = supabase.from("reports").select("*").order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data: rows } = await q;
      const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
      const { data: profs } = userIds.length
        ? await supabase.from("profiles").select("id,full_name,email").in("id", userIds)
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{r.profile?.full_name ?? "Unknown user"}</div>
          <div className="text-xs text-muted-foreground truncate">{r.profile?.email}</div>
        </div>
        <StatusBadge
          label={r.status}
          className={r.status === "resolved" ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"}
        />
      </div>
      <p className="text-sm whitespace-pre-wrap">{r.description}</p>
      {r.job_id && <p className="text-[11px] text-muted-foreground">Related job: <code>{r.job_id}</code></p>}
      <p className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</p>
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
