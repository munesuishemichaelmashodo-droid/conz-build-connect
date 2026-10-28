import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";
import { payoutStatusLabel } from "@/lib/payout-status";

type Row = {
  id: string;
  driver_id: string;
  job_id: string;
  amount: number;
  status: string;
  livemode: boolean;
  ecocash_number: string | null;
  provider_reference: string | null;
  attempts: number;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
};

// 0121 columns are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Admin view of automatic driver payouts (0121). Super admins can send a returned payout again. */
export function DriverPayoutsAdmin({ canRetry = false }: { canRetry?: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: ["admin-driver-payouts"],
    queryFn: async (): Promise<Row[]> => {
      const r = await db
        .from("driver_payouts")
        .select(
          "id,driver_id,job_id,amount,status,livemode,ecocash_number,provider_reference,attempts,failure_code,failure_message,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(30);
      if (r.error) throw r.error;
      return (r.data ?? []) as Row[];
    },
    retry: false,
  });
  if (error || !data || data.length === 0) return null;

  const retry = async (row: Row) => {
    const reason = window.prompt(
      `Send $${row.amount} to EcoCash •••• ${row.ecocash_number?.slice(-4) ?? "?"} again. It comes out of the driver's wallet. Reason:`,
    );
    if (!reason) return;
    setBusy(row.id);
    const { error: err } = await db.rpc("admin_retry_payout", { _id: row.id, _reason: reason });
    setBusy(null);
    if (err) {
      if (isMfaRequiredError(err)) {
        toast.error(readableRpcError(err), {
          action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
        });
      } else toast.error(readableRpcError(err));
      return;
    }
    toast.success("Payout queued again");
    void qc.invalidateQueries({ queryKey: ["admin-driver-payouts"] });
  };

  return (
    <section className="space-y-2 rounded-xl border p-4" aria-labelledby="driver-payouts-title">
      <h2 id="driver-payouts-title" className="font-semibold">
        Driver payouts (Con Z Pay)
      </h2>
      <p className="text-sm text-muted-foreground">
        Sent automatically to the driver's EcoCash when a Payonify-paid job is released. A payout
        that could not be sent is back in the driver's wallet.
      </p>
      <ul className="divide-y text-sm">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block font-medium">
                {money(Number(r.amount))} · {payoutStatusLabel(r.status)}
                {!r.livemode && " · test"}
              </span>
              <span className="block text-xs text-muted-foreground break-all">
                {new Date(r.created_at).toLocaleString()} · EcoCash ••••{" "}
                {r.ecocash_number?.slice(-4) ?? "none"}
                {r.provider_reference ? ` · ${r.provider_reference}` : ""}
                {r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
                {r.failure_code ? ` · ${r.failure_code}` : ""}
                {r.failure_message ? `: ${r.failure_message}` : ""}
              </span>
            </span>
            {canRetry && r.status === "returned" && !r.provider_reference && (
              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => retry(r)}>
                Send again
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
