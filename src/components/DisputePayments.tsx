import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Banknote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { currentAgreement, payLine, type JobAgreement } from "@/lib/agreement";
import {
  directMethodLabel,
  parseStageRecords,
  stageAmountsDisagree,
  stageName,
  type PaymentStageRecord,
} from "@/lib/direct-payment";

// Admin dispute panel: what the two parties agreed about payment (0157/0179) and what each says happened, per stage
// (0179), with the append-only history. Read under the admins' own RLS access. Statements only: Con Z did not handle
// the money, so nothing here proves a payment either way.

type Hist = {
  stage: string;
  action: string;
  amount: number | null;
  created_at: string;
  actor: string;
};

export function DisputePayments({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dispute-payments", jobId],
    enabled: open,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0179 objects are newer than the generated types
      const db = supabase as any;
      const [{ data: agreements }, stages, history] = await Promise.all([
        db
          .from("job_agreements")
          .select("*")
          .eq("job_id", jobId)
          .order("version", { ascending: false }),
        db.from("direct_payment_stages").select("*").eq("job_id", jobId),
        db
          .from("direct_payment_stage_events")
          .select("stage, action, amount, created_at, actor")
          .eq("job_id", jobId)
          .order("created_at", { ascending: true }),
      ]);
      return {
        agreement: currentAgreement((agreements ?? []) as JobAgreement[]),
        records: stages.error ? null : parseStageRecords(stages.data),
        history: (history.data ?? []) as Hist[],
      };
    },
  });

  return (
    <div className="mt-3 border-t pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground"
      >
        <span className="flex items-center gap-1">
          <Banknote className="w-3.5 h-3.5" /> Agreement and payments
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {open && (
        <div className="space-y-2 pt-2 text-xs" data-testid="dispute-payments">
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : isError || !data ? (
            <p role="alert" className="font-semibold text-destructive">
              Couldn't load the agreement and payments. Open this again before deciding.
            </p>
          ) : (
            <>
              <p>
                <span className="font-semibold">Agreement: </span>
                {data.agreement
                  ? `${payLine(data.agreement)} (version ${data.agreement.version}, ${data.agreement.status})`
                  : "None recorded."}
              </p>
              {data.agreement?.cancellation_terms && (
                <p>
                  <span className="font-semibold">If cancelled: </span>
                  {data.agreement.cancellation_terms}
                </p>
              )}
              {data.records === null ? (
                <p className="text-muted-foreground">
                  Payment stages are not available on this database yet.
                </p>
              ) : data.records.length === 0 ? (
                <p className="text-muted-foreground">Neither party recorded a payment.</p>
              ) : (
                data.records.map((r) => <StageLine key={r.stage} r={r} />)
              )}
              {data.history.length > 0 && (
                <ol className="space-y-0.5 text-muted-foreground">
                  {data.history.map((h, i) => (
                    <li key={i}>
                      {new Date(h.created_at).toLocaleString()} ·{" "}
                      {stageName(h.stage as PaymentStageRecord["stage"])} ·{" "}
                      {h.action.replace(/_/g, " ")}
                      {h.amount != null ? ` · $${Number(h.amount).toFixed(2)}` : ""}
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-muted-foreground">
                These are the parties' own statements. Con Z did not handle this money.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StageLine({ r }: { r: PaymentStageRecord }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="font-semibold">
        {stageName(r.stage)} · agreed ${r.expectedAmount.toFixed(2)}
        {stageAmountsDisagree(r) && <span className="ml-1 text-destructive">· amounts differ</span>}
      </div>
      <div>
        Customer:{" "}
        {r.customerClaimedAt
          ? `says paid $${r.customerAmount?.toFixed(2)} by ${directMethodLabel(r.customerMethod)}${r.customerReference ? ` (ref ${r.customerReference})` : ""}`
          : "nothing recorded"}
      </div>
      <div>
        Driver:{" "}
        {r.driverConfirmedAt
          ? `confirmed $${r.driverAmount?.toFixed(2)} by ${directMethodLabel(r.driverMethod)}${r.driverReference ? ` (ref ${r.driverReference})` : ""}`
          : "nothing recorded"}
      </div>
      {r.customerAcknowledgedAt && <div>Customer agreed with the driver's confirmation.</div>}
    </div>
  );
}
