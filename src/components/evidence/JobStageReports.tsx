import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COLLECTION_PROBLEMS,
  CONDITIONS,
  DELAY_REASONS,
  DELIVERY_PROBLEMS,
  EVENT_TITLE,
  availableReports,
  reportLine,
  type StageEvent,
  type StageReport,
} from "@/lib/stage-reports";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const call = (f: string, a: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);

/**
 * Collection, delay and delivery reports for one job (0187). Statements by the customer or driver, kept as a record;
 * corrections are new reports. Hidden if the database does not have reports yet.
 */
export function JobStageReports({
  jobId,
  jobStatus,
  role,
  hasPickupPhoto,
  completedAt,
}: {
  jobId: string;
  jobStatus: string;
  role: "customer" | "driver" | null;
  hasPickupPhoto: boolean;
  completedAt: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<StageEvent | null>(null);
  const [issue, setIssue] = useState("");
  const [condition, setCondition] = useState("as_agreed");
  const [qty, setQty] = useState("");
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: reports, isError } = useQuery({
    queryKey: ["job-stage-reports", jobId],
    queryFn: async () => {
      const { data, error } = await (
        supabase.from as unknown as (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              order: (
                k: string,
                o: { ascending: boolean },
              ) => Promise<{ data: StageReport[] | null; error: unknown }>;
            };
          };
        }
      )("job_stage_reports")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isError) return null;
  const actions = availableReports(role, jobStatus, hasPickupPhoto, completedAt);
  if (!actions.length && !reports?.length) return null;

  const start = (e: StageEvent) => {
    setOpen(e);
    setIssue("");
    setCondition("as_agreed");
    setQty("");
    setEta("");
    setNote("");
  };

  const submit = async () => {
    if (!open) return;
    setBusy(true);
    const { error } = await call("report_job_stage", {
      _job: jobId,
      _event: open,
      _issue: issue || null,
      _condition: open === "collection_confirmed" ? condition : null,
      _quantity_m3: qty ? Number(qty) : null,
      _eta_minutes: eta ? Number(eta) : null,
      _note: note || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Recorded on this job");
    setOpen(null);
    qc.invalidateQueries({ queryKey: ["job-stage-reports", jobId] });
  };

  const options =
    open === "collection_problem"
      ? COLLECTION_PROBLEMS
      : open === "delay"
        ? DELAY_REASONS
        : open === "delivery_problem"
          ? DELIVERY_PROBLEMS
          : null;
  const needsQty =
    open === "collection_confirmed" ||
    (open === "delivery_problem" && (issue === "shortage" || issue === "partial_delivery"));

  return (
    <section
      className="rounded-2xl border border-cz-border bg-cz-surface p-4 space-y-3"
      aria-label="Job reports"
    >
      <div>
        <div className="font-semibold">Collection and delivery reports</div>
        <div className="text-[13px] text-cz-muted">
          What each of you reports is kept on this job and cannot be edited. Con Z has not checked
          these reports; they help if there is a dispute.
        </div>
      </div>

      {!!reports?.length && (
        <ul className="space-y-2" data-testid="stage-report-list">
          {reports.map((r) => (
            <li key={r.id} className="rounded-lg border p-2.5 text-[13px]">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{EVENT_TITLE[r.event]}</span>
                <span className="text-cz-muted shrink-0">
                  {new Date(r.created_at).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p>{reportLine(r)}</p>
              {r.note && <p className="text-cz-muted">“{r.note}”</p>}
              {r.corrects_report && (
                <p className="text-xs text-cz-muted">Correction of an earlier report.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open && actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((e) => (
            <Button
              key={e}
              size="sm"
              variant={e === "collection_confirmed" ? "default" : "outline"}
              onClick={() => start(e)}
            >
              {e === "collection_confirmed"
                ? "Confirm what was loaded"
                : e === "collection_problem"
                  ? "Problem at collection"
                  : e === "delay"
                    ? "Report a delay"
                    : "Report a problem with the delivery"}
            </Button>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-2.5" data-testid="stage-report-form">
          <p className="text-sm font-semibold">{EVENT_TITLE[open]}</p>
          {options && (
            <label className="block text-sm">
              {open === "delay" ? "Reason" : "What happened"}
              <select
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-2"
              >
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {open === "collection_confirmed" && (
            <label className="block text-sm">
              What the load looks like
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-2"
              >
                {CONDITIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(needsQty || open === "collection_problem") && (
            <label className="block text-sm">
              {open === "delivery_problem" ? "Quantity that arrived (m³)" : "Quantity loaded (m³)"}
              <Input
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 10"
              />
            </label>
          )}
          {open === "delay" && (
            <label className="block text-sm">
              New arrival in (minutes)
              <Input
                inputMode="numeric"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                placeholder="e.g. 45"
              />
            </label>
          )}
          <label className="block text-sm">
            Details {issue === "other" || condition === "other" ? "" : "(optional)"}
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
          {open === "delivery_problem" && (
            <p className="text-xs text-cz-muted">
              This records what happened. To ask Con Z to review it, open a dispute from this job as
              well.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={submit}>
              Save report
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
