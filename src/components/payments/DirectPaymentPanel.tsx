import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  DIRECT_PAYMENT_METHODS,
  directMethodLabel,
  directPaymentStatusLine,
  disputeLabel,
  disputeState,
  parseConfirmation,
  type DirectPaymentConfirmation,
  type DisputeState,
} from "@/lib/direct-payment";

// Direct-pay jobs (customer pays the driver). Shows what ConZ actually knows: the agreed price, that ConZ did not
// handle the payment, whether the DRIVER confirmed receiving it (0176) and the dispute status. The driver can
// confirm once. Renders nothing until 0176 exists on the database.

type Loaded = { confirmation: DirectPaymentConfirmation | null; dispute: DisputeState };

type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function load(jobId: string): Promise<Loaded | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0176 table is newer than the generated types
  const db = supabase as any;
  const { data: conf, error } = await db
    .from("direct_payment_confirmations")
    .select("method, amount, agreed_amount, reference, confirmed_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return null; // table missing (0176 not applied) or not readable: show nothing
  const { data: disputes } = await db.from("disputes").select("status").eq("job_id", jobId);
  return { confirmation: parseConfirmation(conf), dispute: disputeState(disputes) };
}

export function DirectPaymentPanel({
  jobId,
  role,
  agreedPrice,
  jobStatus,
}: {
  jobId: string;
  role: "driver" | "customer";
  agreedPrice: number;
  jobStatus: string;
}) {
  const qc = useQueryClient();
  const key = ["direct-payment", jobId];
  const { data } = useQuery({ queryKey: key, queryFn: () => load(jobId), staleTime: 30_000 });
  const [method, setMethod] = useState<string>("");
  const [amount, setAmount] = useState<string>(agreedPrice > 0 ? agreedPrice.toFixed(2) : "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const canConfirm =
    role === "driver" &&
    !data.confirmation &&
    ["accepted", "in_progress", "completed"].includes(jobStatus);

  const confirm = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as unknown as RpcFn)("driver_confirm_direct_payment", {
      _job_id: jobId,
      _method: method,
      _amount: Number(amount),
      _reference: reference.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "Could not save the confirmation.");
      return;
    }
    toast.success("Payment confirmation saved.");
    await qc.invalidateQueries({ queryKey: key });
  };

  return (
    <div
      className="space-y-2 rounded-2xl border border-cz-border p-4 text-[13px]"
      data-testid="direct-payment-panel"
    >
      <div className="flex justify-between">
        <span className="text-cz-muted">Agreed price</span>
        <span className="font-semibold tabular-nums">${agreedPrice.toFixed(2)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-cz-muted">Payment</span>
        <span className="text-right">Paid directly to the driver (not handled by Con Z)</span>
      </div>
      <p className="text-cz-muted">{directPaymentStatusLine(data.confirmation, true)}</p>
      <div className="flex justify-between">
        <span className="text-cz-muted">Disputes</span>
        <span>{disputeLabel(data.dispute)}</span>
      </div>

      {canConfirm && (
        <div className="space-y-2 border-t border-cz-border pt-3">
          <div className="font-semibold">Confirm you received the customer's payment</div>
          <label className="block">
            <span className="text-cz-muted">How were you paid?</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5"
            >
              <option value="">Choose…</option>
              {DIRECT_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {directMethodLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-cz-muted">Amount you received (USD)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-cz-muted">Payment reference (optional, e.g. EcoCash code)</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5"
              autoComplete="off"
            />
          </label>
          <p className="text-cz-muted">
            This records your own confirmation. It cannot be changed later; if something is wrong,
            raise a dispute.
          </p>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || !method || !(Number(amount) > 0)}
            className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Confirm payment received"}
          </button>
        </div>
      )}
    </div>
  );
}
