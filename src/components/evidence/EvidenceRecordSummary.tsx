import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { EVENT_TITLE, reportLine, type StageReport } from "@/lib/stage-reports";
import { evidenceRecordFlags, type EvidenceRecord } from "@/lib/evidence-record";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** The job's evidence record (0187) for the admin dispute panel. Hidden before 0187 is applied. */
export function EvidenceRecordSummary({ jobId }: { jobId: string }) {
  const { data } = useQuery({
    queryKey: ["job-evidence-record", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("job_evidence_record", {
        _job: jobId,
      });
      if (error) return null;
      return data as EvidenceRecord;
    },
  });
  if (!data) return null;
  const flags = evidenceRecordFlags(data);
  return (
    <div className="rounded-lg border p-2.5 space-y-2 text-[11px]" data-testid="evidence-record">
      <p className="font-semibold text-xs">Evidence record</p>
      <p className="text-muted-foreground">{data.basis}</p>
      {flags.length > 0 && (
        <ul className="space-y-0.5">
          {flags.map((f) => (
            <li key={f} className="text-warning font-semibold">
              • {f}
            </li>
          ))}
        </ul>
      )}
      <ol className="space-y-0.5">
        {data.timeline.map((t) => (
          <li key={t.step} className="flex justify-between gap-2">
            <span>{t.step.replace(/_at$/, "").replace(/_/g, " ")}</span>
            <span className="text-muted-foreground">{new Date(t.at).toLocaleString("en-GB")}</span>
          </li>
        ))}
      </ol>
      {data.reports.length > 0 && (
        <ul className="space-y-1">
          {data.reports.map((r) => (
            <li key={r.id}>
              <span className="font-semibold">
                {EVENT_TITLE[r.event as StageReport["event"]] ?? r.event}:{" "}
              </span>
              {reportLine({ ...(r as unknown as StageReport), reporter_role: r.by_role })}
              {r.note ? ` “${r.note}”` : ""}
              {r.added_after_dispute ? " (after the dispute opened)" : ""}
            </li>
          ))}
        </ul>
      )}
      <p>
        Delivery code:{" "}
        {data.delivery_code.verification === "system_checked"
          ? `confirmed by the system ${new Date(data.delivery_code.confirmed_at as string).toLocaleString("en-GB")}`
          : "not confirmed"}
        {data.delivery_code.wrong_attempts
          ? ` · ${data.delivery_code.wrong_attempts} wrong attempt(s)`
          : ""}
        {data.recorded_gps_points != null
          ? ` · ${data.recorded_gps_points} recorded GPS points`
          : ""}
      </p>
    </div>
  );
}
