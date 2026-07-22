import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Loader2, MessageSquareWarning } from "lucide-react";

export const Route = createFileRoute("/_authenticated/report")({
  component: ReportPage,
  validateSearch: (s: Record<string, unknown>) => ({ jobId: typeof s.jobId === "string" ? s.jobId : undefined }),
});

function ReportPage() {
  const { userId } = useAuth();
  const { jobId } = Route.useSearch();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [description, setDescription] = useState("");
  const [linkedJob, setLinkedJob] = useState<string>(jobId ?? "");
  const [submitting, setSubmitting] = useState(false);

  const { data: myJobs } = useQuery({
    queryKey: ["report-my-jobs", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id,material,status,created_at")
        .or(`customer_id.eq.${userId},driver_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const { data: mine } = useQuery({
    queryKey: ["my-reports", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("reports")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const submit = async () => {
    if (description.trim().length < 5) return toast.error("Please describe the issue in a bit more detail.");
    setSubmitting(true);
    const { error } = await supabase.from("reports").insert({
      user_id: userId!,
      description: description.trim(),
      job_id: linkedJob || null,
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Report submitted. Admins have been notified.");
    setDescription("");
    setLinkedJob("");
    qc.invalidateQueries({ queryKey: ["my-reports", userId] });
    setTimeout(() => nav({ to: "/home" }), 800);
  };

  return (
    <AppShell title="Report an issue">
      <div className="max-w-xl mx-auto space-y-6">
        <section className="rounded-2xl bg-card border p-5 shadow-soft space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="w-5 h-5 text-primary" />
            <h2 className="font-display font-bold uppercase tracking-wide">Report an issue</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Tell us what happened. Admins review every report and will follow up if we need more info.
          </p>

          <div>
            <Label htmlFor="desc">What's the issue?</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Describe what happened, when it happened, and anyone involved…"
            />
          </div>

          <div>
            <Label htmlFor="job">Related job (optional)</Label>
            <select
              id="job"
              value={linkedJob}
              onChange={(e) => setLinkedJob(e.target.value)}
              className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— No specific job —</option>
              {(myJobs ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.material} • {j.status} • {new Date(j.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit report"}
          </Button>
        </section>

        {(mine ?? []).length > 0 && (
          <section className="space-y-2">
            <h3 className="font-display font-bold uppercase tracking-wide text-sm">Your recent reports</h3>
            <div className="space-y-2">
              {mine!.map((r) => (
                <div key={r.id} className="rounded-xl border bg-card p-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase font-semibold text-muted-foreground">{r.status}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
                  {r.admin_notes && (
                    <p className="mt-2 text-xs bg-muted p-2 rounded">
                      <b>Admin reply:</b> {r.admin_notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
