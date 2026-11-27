import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const call = (f: string, a?: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);
type Json = Record<string, unknown>;
type Table = (t: string) => {
  select: (c: string) => {
    eq: (k: string, v: string) => Promise<{ data: Json[] | null; error: unknown }>;
  };
};

/**
 * One evidence view for a job, for admins (0193). Each section comes from its own access-checked database function
 * and is simply left out when that function is not available yet. Opening the view is logged.
 * Labels keep the difference between what a person submitted and what the system checked.
 */
export function JobEvidenceVault({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["job-evidence-vault", jobId],
    enabled: open,
    queryFn: async () => {
      const [history, record, payments, agreements] = await Promise.all([
        call("admin_job_history", { _job: jobId }),
        call("job_evidence_record", { _job: jobId }),
        call("job_payment_reconciliation", { _job: jobId }),
        (supabase.from as unknown as Table)("job_agreements")
          .select("version,status,fare,payment_channel,deposit_amount,content_hash")
          .eq("job_id", jobId),
      ]);
      if (history.error) throw new Error(history.error.message);
      return {
        history: history.data as Json,
        record: record.error ? null : (record.data as Json),
        payments: payments.error ? null : (payments.data as Json),
        agreements: agreements.error ? null : (agreements.data ?? []),
      };
    },
  });

  const list = (v: unknown) => (Array.isArray(v) ? (v as Json[]) : []);
  return (
    <div
      className="mt-1 rounded-xl border bg-card p-3 text-xs space-y-2"
      data-testid="job-evidence-vault"
    >
      <button
        type="button"
        className="min-h-11 font-semibold underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide evidence" : "Evidence (opening this is logged)"}
      </button>
      {open && isLoading && <p>Loading…</p>}
      {open && isError && <p className="text-destructive">The evidence view is not available.</p>}
      {open && data && (
        <div className="space-y-3">
          <Section title="Timeline">
            {list(data.history.timeline).map((t) => (
              <li key={String(t.step)}>
                {String(t.step).replace(/_at$/, "").replace(/_/g, " ")}:{" "}
                {new Date(String(t.at)).toLocaleString("en-GB")}
              </li>
            ))}
          </Section>
          {data.agreements && (
            <Section title={`Agreement versions (${data.agreements.length})`}>
              {data.agreements.map((a) => (
                <li key={String(a.version)}>
                  v{String(a.version)} {String(a.status)} · ${String(a.fare)} ·{" "}
                  {String(a.payment_channel ?? "")}
                  {a.deposit_amount ? ` · deposit $${String(a.deposit_amount)}` : ""}
                  {a.content_hash ? " · fingerprint stored" : ""}
                </li>
              ))}
            </Section>
          )}
          {data.record && (
            <Section title="Collection and delivery (photos are submitted; reports are statements)">
              <li>{String(data.record.basis ?? "")}</li>
              <li>
                Photos: {list(data.record.photos).length} · reports:{" "}
                {list(data.record.reports).length} · delivery code:{" "}
                {String((data.record.delivery_code as Json | undefined)?.verification ?? "")}
              </li>
            </Section>
          )}
          {data.payments && (
            <Section title="Payments (the customer pays the driver directly)">
              {list(data.payments.stages).map((s) => (
                <li key={String(s.stage)}>
                  {String(s.stage)}: {String(s.state).replace(/_/g, " ")}
                </li>
              ))}
              <li>
                Outstanding: $
                {String((data.payments.totals as Json | undefined)?.outstanding ?? "")}
              </li>
            </Section>
          )}
          <Section title="Disputes and reports">
            {[...list(data.history.disputes), ...list(data.history.reports)].map((x) => (
              <li key={String(x.id)}>
                {String(x.category ?? "")} · {String(x.status ?? "")}
                {x.outcome ? ` · ${String(x.outcome)}` : ""}
              </li>
            ))}
          </Section>
          <Section title="Admin actions">
            {list(data.history.admin_actions).map((a, i) => (
              <li key={i}>
                {new Date(String(a.at)).toLocaleString("en-GB")} · {String(a.action)}
                {a.reason ? `: ${String(a.reason)}` : ""}
              </li>
            ))}
          </Section>
          <Section title="Opened by">
            {list(data.history.viewed_by)
              .slice(0, 10)
              .map((v, i) => (
                <li key={i}>
                  {String(v.actor_id).slice(0, 8)} ·{" "}
                  {new Date(String(v.at)).toLocaleString("en-GB")}
                </li>
              ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="list-disc pl-4 space-y-0.5">{children}</ul>
    </div>
  );
}
