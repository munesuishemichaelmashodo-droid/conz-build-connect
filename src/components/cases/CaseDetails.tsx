import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CASE_STATUS_LABEL } from "@/lib/report-categories";

type Case = {
  id: string;
  case_ref: string | null;
  case_status: string;
  severity: string | null;
  decision: string | null;
  decision_reason: string | null;
  decision_policy: string | null;
  decided_at: string | null;
  appeal_decision: string | null;
  appeal_reason: string | null;
};
type Ev = {
  id: number;
  actor_role: string;
  action: string;
  body: string | null;
  created_at: string;
};
type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const call = (f: string, a?: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);

const ACTION: Record<string, string> = {
  reported: "Reported",
  statement: "Statement",
  evidence: "File added",
  assigned: "Assigned",
  severity_changed: "Severity changed",
  protective_action: "Action taken",
  decided: "Decision",
  appealed: "Appeal",
  appeal_decided: "Appeal decision",
  closed: "Closed",
};

/** A case as the reporter or the affected person sees it (0192): status, decision, history, their side, appeal. */
export function CaseDetails({ reportId }: { reportId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["case", reportId],
    queryFn: async () => {
      const db = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              maybeSingle: () => Promise<{ data: Case | null; error: unknown }>;
              order: (
                k: string,
                o: { ascending: boolean },
              ) => Promise<{ data: Ev[] | null; error: unknown }>;
            };
          };
        };
      };
      const c = await db
        .from("reports")
        .select(
          "id,case_ref,case_status,severity,decision,decision_reason,decision_policy,decided_at,appeal_decision,appeal_reason",
        )
        .eq("id", reportId)
        .maybeSingle();
      if (c.error || !c.data) return null;
      const ev = await db
        .from("case_events")
        .select("id,actor_role,action,body,created_at")
        .eq("report_id", reportId)
        .order("id", { ascending: true });
      return { c: c.data, events: ev.data ?? [] };
    },
  });
  if (!data) return null;
  const { c, events } = data;
  const run = async (f: string, a: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await call(f, a);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(ok);
    setText("");
    qc.invalidateQueries({ queryKey: ["case", reportId] });
  };
  return (
    <div className="mt-2 space-y-2 rounded-lg border p-2.5 text-[13px]" data-testid="case-details">
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{c.case_ref}</span>
        <span className="text-muted-foreground">
          {CASE_STATUS_LABEL[c.case_status] ?? c.case_status}
        </span>
      </div>
      {c.decision && (
        <p>
          <b>Decision:</b> {c.decision}. <b>Why:</b> {c.decision_reason}{" "}
          <span className="text-muted-foreground">(policy: {c.decision_policy})</span>
        </p>
      )}
      {c.appeal_decision && (
        <p>
          <b>Appeal:</b> {c.appeal_decision === "upheld" ? "decision kept" : "decision changed"}.{" "}
          {c.appeal_reason}
        </p>
      )}
      <ol className="space-y-1 border-l pl-2">
        {events.map((e) => (
          <li key={e.id}>
            <span className="text-muted-foreground">
              {new Date(e.created_at).toLocaleDateString("en-GB")} · {ACTION[e.action] ?? e.action}{" "}
              ({e.actor_role})
            </span>
            {e.body ? `: ${e.body}` : ""}
          </li>
        ))}
      </ol>
      {c.case_status !== "closed" && (
        <div className="space-y-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            className="w-full rounded-md border bg-background p-2"
            placeholder={
              c.case_status === "decided"
                ? "Add to your side, or explain why the decision is wrong"
                : "Add your side of what happened"
            }
            aria-label="Your statement"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !text.trim()}
              onClick={() =>
                run("case_add_statement", { _report: reportId, _body: text }, "Added to the case")
              }
            >
              Add statement
            </Button>
            {c.case_status === "decided" && (
              <Button
                size="sm"
                disabled={busy || text.trim().length < 10}
                onClick={() =>
                  run(
                    "case_appeal",
                    { _report: reportId, _grounds: text },
                    "Appeal sent. A different person will review it.",
                  )
                }
              >
                Appeal the decision
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
