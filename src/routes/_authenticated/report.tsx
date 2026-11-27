import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CaseDetails } from "@/components/cases/CaseDetails";
import { sentence } from "@/lib/status-stamp";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Loader2, MessageSquareWarning, ShieldAlert } from "lucide-react";
import {
  REPORT_CATEGORIES,
  isReportCategory,
  isUrgentCategory,
  reportCategoryLabel,
  type ReportCategory,
} from "@/lib/report-categories";

export const Route = createFileRoute("/_authenticated/report")({
  component: ReportPage,
  validateSearch: (s: Record<string, unknown>) => ({
    jobId: typeof s.jobId === "string" ? s.jobId : undefined,
    category: isReportCategory(s.category) ? s.category : undefined,
  }),
});

function ReportPage() {
  const { userId } = useAuth();
  const { jobId, category: initialCategory } = Route.useSearch();
  const [category, setCategory] = useState<ReportCategory>(initialCategory ?? "general");
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

  // 0192: cases where someone else reported a problem involving this user: they can give their side and appeal.
  const { data: aboutMe } = useQuery({
    queryKey: ["cases-about-me", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reports")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0192 columns are newer than the generated types
        .select("id,case_ref,created_at" as any)
        .eq("affected_user_id" as never, userId!)
        .order("created_at", { ascending: false });
      return error ? [] : ((data ?? []) as unknown as { id: string; case_ref: string | null }[]);
    },
  });

  const { data: mine } = useQuery({
    queryKey: ["my-reports", userId],
    enabled: !!userId,
    queryFn: async () => {
      // Public columns only: the private admin note is not readable by customers (0142). Before 0142 is
      // applied admin_reply does not exist yet, so fall back to the columns that do.
      const read = (cols: string) =>
        supabase
          .from("reports")
          .select(cols)
          .eq("user_id", userId!)
          .order("created_at", { ascending: false })
          .limit(20);
      let res = await read("id,description,status,created_at,admin_reply,admin_reply_at");
      if (res.error) res = await read("id,description,status,created_at");
      return (res.data ?? []) as unknown as {
        id: string;
        description: string;
        status: string;
        created_at: string;
        admin_reply?: string | null;
        admin_reply_at?: string | null;
      }[];
    },
  });

  const submit = async () => {
    if (description.trim().length < 5) return toast.error("Please describe the issue in a bit more detail.");
    setSubmitting(true);
    const row = { user_id: userId!, description: description.trim(), job_id: linkedJob || null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0178 column is newer than the generated types
    let { error } = await supabase.from("reports").insert({ ...row, category } as any);
    // Before 0178 is applied the category column does not exist: send the report without it.
    if (error && /category|column|permission/i.test(error.message)) {
      ({ error } = await supabase.from("reports").insert(row));
    }
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success(
      isUrgentCategory(category)
        ? "Report submitted. It is marked urgent and admins have been alerted."
        : "Report submitted. Admins have been notified.",
    );
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
            <MessageSquareWarning className="w-5 h-5 text-cz-amber-text" />
            <h2 className="font-display font-bold">Report an issue</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Tell us what happened. Admins review every report and will follow up if we need more info.
          </p>

          <div
            className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs"
            data-testid="report-emergency-note"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p>
              <b>If anyone is in danger right now, call the police (995) or emergency services (999) first.</b>{" "}
              Con Z is not an emergency service and does not watch trips live. Reports are read by our team, and
              safety and fraud reports are marked urgent.
            </p>
          </div>

          <div>
            <Label htmlFor="category">What kind of problem?</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            >
              {REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {reportCategoryLabel(c)}
                </option>
              ))}
            </select>
          </div>

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
            <h3 className="font-semibold text-sm">Your recent reports</h3>
            <div className="space-y-2">
              {mine!.map((r) => (
                <div key={r.id} className="rounded-xl border bg-card p-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-muted-foreground">{sentence(r.status)}</span>
                    <span className="text-[11px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
                  {r.admin_reply && (
                    <p className="mt-2 text-xs bg-muted p-2 rounded">
                      <b>Con Z reply:</b> {r.admin_reply}
                    </p>
                  )}
                  <CaseDetails reportId={r.id} />
                </div>
              ))}
            </div>
          </section>
        )}
        {!!aboutMe?.length && (
          <section className="space-y-2" aria-label="Cases involving you">
            <h2 className="font-semibold text-sm">Cases involving you</h2>
            <p className="text-xs text-muted-foreground">
              Someone reported a problem that involves you. Give your side; you will be told the
              decision and can appeal it.
            </p>
            {aboutMe.map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-3 text-sm">
                <CaseDetails reportId={r.id} />
              </div>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}
