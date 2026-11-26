import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  agreedMethod,
  DEPOSIT_DUES,
  PAYMENT_METHODS,
  PAYMENT_TIMINGS,
  agreementView,
  carriedDeposit,
  currentAgreement,
  methodLabel,
  payLine,
  paymentPlanLabel,
  timingLabel,
  type JobAgreement,
} from "@/lib/agreement";

type RpcResult = { data: unknown; error: { message: string } | null };
const call = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>)(
    fn,
    args,
  );

/**
 * What the customer and the driver agreed, in one place: fare (from the job), how and when it is paid,
 * deposit paid to the driver, timing, what is included. Each change is a new version; both sides accept.
 * ConZ records it and never holds or moves this money.
 */
export function AgreementCard({
  jobId,
  jobStatus,
  userId,
  customerId,
}: {
  jobId: string;
  jobStatus: string;
  userId: string | null;
  /** The job's customer: only the driver may propose or change a deposit (0162). */
  customerId?: string | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("cash");
  const [timing, setTiming] = useState("on_delivery");
  const [deposit, setDeposit] = useState("");
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [inc, setInc] = useState("");
  const [exc, setExc] = useState("");
  // 0179 payment terms. Deposit timing and reason, and where the driver is paid, are the driver's to set.
  const [depositDue, setDepositDue] = useState("before_pickup");
  const [depositReason, setDepositReason] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAccount, setRecipientAccount] = useState("");
  const [instructions, setInstructions] = useState("");
  const [cancelTerms, setCancelTerms] = useState("");

  const { data: rows, isError } = useQuery({
    queryKey: ["job-agreements", jobId],
    enabled: !!userId,
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
              ) => Promise<{ data: JobAgreement[] | null; error: unknown }>;
            };
          };
        }
      )("job_agreements")
        .select("*")
        .eq("job_id", jobId)
        .order("version", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Quiet when the feature is not available yet (older database) or the job is not assigned.
  if (isError || !["accepted", "in_progress"].includes(jobStatus)) {
    const done = currentAgreement(rows);
    if (!done) return null;
  }

  const current = currentAgreement(rows);
  const isCustomer = !!userId && userId === customerId;
  const carried = carriedDeposit(rows);
  const view = agreementView(current, userId);
  const open = ["accepted", "in_progress"].includes(jobStatus);
  const refresh = () => qc.invalidateQueries({ queryKey: ["job-agreements", jobId] });

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await call(fn, args);
    setBusy(false);
    if (error) {
      // The driver changed the deposit while this form was open: show the new one instead of a bare refusal.
      if (/only the driver can propose or change a deposit/i.test(error.message)) {
        refresh();
        return toast.error(
          "The driver changed the deposit. Close this form and open it again to see it.",
        );
      }
      return toast.error(error.message);
    }
    toast.success(ok);
    setEditing(false);
    refresh();
  };

  const propose = async () => {
    const base = {
      _job: jobId,
      _payment_method: method,
      _payment_timing: timing,
      _deposit_amount: isCustomer ? carried : Number(deposit) || 0,
      _pickup_window: pickup,
      _delivery_window: delivery,
      _inclusions: inc,
      _exclusions: exc,
    };
    const ok = "Sent. The other person will be asked to confirm.";
    setBusy(true);
    const terms = await call("propose_job_agreement_terms", {
      ...base,
      _deposit_due: (Number(deposit) || 0) > 0 ? depositDue : null,
      _deposit_reason: depositReason,
      _recipient_name: recipientName,
      _recipient_account: recipientAccount,
      _payment_instructions: instructions,
      _cancellation_terms: cancelTerms,
    });
    setBusy(false);
    // Before 0179 is applied the function does not exist: use the 0163 one (no payment details).
    if (
      terms.error &&
      /propose_job_agreement_terms|function .* does not exist|schema cache/i.test(
        terms.error.message,
      )
    ) {
      return run("propose_job_agreement", base, ok);
    }
    if (terms.error) {
      if (/only the driver can propose or change a deposit/i.test(terms.error.message)) {
        refresh();
        return toast.error(
          "The driver changed the deposit. Close this form and open it again to see it.",
        );
      }
      return toast.error(terms.error.message);
    }
    toast.success(ok);
    setEditing(false);
    refresh();
  };

  return (
    <section
      className="rounded-2xl border border-cz-border bg-cz-surface p-4 space-y-3"
      aria-label="Agreement"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Agreement</div>
          <div className="text-[13px] text-cz-muted">
            Set out what you both expect. The fare is paid directly to the driver; Con Z does not
            hold it.
          </div>
        </div>
        {current && <span className="text-xs text-cz-muted">Version {current.version}</span>}
      </div>

      {current && !editing && (
        <div className="space-y-1.5 text-sm">
          <p className="text-xs font-semibold text-cz-muted">{paymentPlanLabel(current)}</p>
          <p>{payLine(current)}</p>
          {current.deposit_reason && (
            <p>
              <span className="text-cz-muted">Why a deposit: </span>
              {current.deposit_reason}
            </p>
          )}
          {(current.recipient_name || current.recipient_account) && (
            <p data-testid="agreement-recipient">
              <span className="text-cz-muted">Pay to: </span>
              {[current.recipient_name, current.recipient_account].filter(Boolean).join(", ")}
            </p>
          )}
          {current.payment_instructions && (
            <p>
              <span className="text-cz-muted">Payment instructions: </span>
              {current.payment_instructions}
            </p>
          )}
          {current.cancellation_terms && (
            <p>
              <span className="text-cz-muted">If cancelled: </span>
              {current.cancellation_terms}
            </p>
          )}
          {(current.pickup_window || current.delivery_window) && (
            <p>
              <span className="text-cz-muted">Timing: </span>
              {[
                current.pickup_window && `pickup ${current.pickup_window}`,
                current.delivery_window && `delivery ${current.delivery_window}`,
              ]
                .filter(Boolean)
                .join(", ")}
            </p>
          )}
          {current.inclusions && (
            <p>
              <span className="text-cz-muted">Included: </span>
              {current.inclusions}
            </p>
          )}
          {current.exclusions && (
            <p>
              <span className="text-cz-muted">Not included: </span>
              {current.exclusions}
            </p>
          )}
          <p className="text-xs text-cz-muted">
            {view === "agreed" && "Both of you confirmed this."}
            {view === "waiting_for_other" && "Waiting for the other person to confirm."}
            {view === "needs_my_answer" &&
              "The other person proposed this. Confirm it, or suggest a change."}
          </p>
        </div>
      )}

      {open && view === "needs_my_answer" && current && !editing && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run("accept_job_agreement", { _agreement: current.id }, "Confirmed")}
          >
            Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setMethod(agreedMethod(current));
              setTiming(current.payment_timing);
              setDeposit(current.deposit_amount ? String(current.deposit_amount) : "");
              setPickup(current.pickup_window ?? "");
              setDelivery(current.delivery_window ?? "");
              setInc(current.inclusions ?? "");
              setExc(current.exclusions ?? "");
              setDepositDue(current.deposit_due ?? "before_pickup");
              setDepositReason(current.deposit_reason ?? "");
              setRecipientName(current.recipient_name ?? "");
              setRecipientAccount(current.recipient_account ?? "");
              setInstructions(current.payment_instructions ?? "");
              setCancelTerms(current.cancellation_terms ?? "");
              setEditing(true);
            }}
          >
            Suggest a change
          </Button>
        </div>
      )}

      {open &&
        !editing &&
        (view === "none" || view === "agreed" || view === "waiting_for_other") && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            {current ? "Change the agreement" : "Set out the agreement"}
          </Button>
        )}

      {open && editing && (
        <div className="space-y-2.5">
          <label className="block text-sm">
            How the fare is paid
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border bg-background px-2"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            When it is paid
            <select
              value={timing}
              onChange={(e) => setTiming(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border bg-background px-2"
            >
              {PAYMENT_TIMINGS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {isCustomer ? (
            <p className="text-sm">
              <span className="text-cz-muted">Deposit: </span>
              {carried > 0
                ? `$${carried.toFixed(2)}, proposed by the driver and paid directly to them`
                : "None. Only the driver can propose a deposit."}
            </p>
          ) : (
            <>
              <label className="block text-sm">
                Deposit paid to the driver (USD, optional; the full price means payment in advance)
                <Input
                  inputMode="decimal"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  placeholder="0"
                />
              </label>
              {(Number(deposit) || 0) > 0 && (
                <>
                  <label className="block text-sm">
                    When the deposit is due
                    <select
                      value={depositDue}
                      onChange={(e) => setDepositDue(e.target.value)}
                      className="mt-1 h-10 w-full rounded-md border bg-background px-2"
                    >
                      {DEPOSIT_DUES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    Why a deposit
                    <Input
                      value={depositReason}
                      onChange={(e) => setDepositReason(e.target.value)}
                      maxLength={200}
                      placeholder="e.g. the quarry is paid before loading"
                    />
                  </label>
                </>
              )}
              <label className="block text-sm">
                Name the customer pays
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  maxLength={100}
                  placeholder="Your name as it shows on EcoCash or the bank"
                />
              </label>
              <label className="block text-sm">
                Number or account the customer pays
                <Input
                  value={recipientAccount}
                  onChange={(e) => setRecipientAccount(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. your EcoCash number"
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm">
                Payment instructions (optional)
                <Input
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. put the job number as the reference"
                />
              </label>
              <p className="text-xs text-cz-muted">
                Only this job's customer sees these details. Con Z does not receive or hold the
                money.
              </p>
            </>
          )}
          {isCustomer && current?.recipient_account && (
            <p className="text-sm">
              <span className="text-cz-muted">Pay to: </span>
              {[current.recipient_name, current.recipient_account].filter(Boolean).join(", ")} (set
              by the driver)
            </p>
          )}
          <label className="block text-sm">
            If the job is cancelled (refunds of any deposit)
            <Input
              value={cancelTerms}
              onChange={(e) => setCancelTerms(e.target.value)}
              maxLength={500}
              placeholder="e.g. deposit returned in full if the driver cancels"
            />
          </label>
          <label className="block text-sm">
            Pickup time
            <Input
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              maxLength={120}
              placeholder="e.g. Tuesday morning"
            />
          </label>
          <label className="block text-sm">
            Delivery time
            <Input
              value={delivery}
              onChange={(e) => setDelivery(e.target.value)}
              maxLength={120}
              placeholder="e.g. Tuesday afternoon"
            />
          </label>
          <label className="block text-sm">
            What is included
            <Input
              value={inc}
              onChange={(e) => setInc(e.target.value)}
              maxLength={500}
              placeholder="e.g. loading and offloading"
            />
          </label>
          <label className="block text-sm">
            What is not included
            <Input
              value={exc}
              onChange={(e) => setExc(e.target.value)}
              maxLength={500}
              placeholder="e.g. waiting time over 30 minutes"
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={propose}>
              Send for confirmation
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-cz-muted">
            Chosen: {methodLabel(method).toLowerCase()}, {timingLabel(timing).toLowerCase()}.
          </p>
        </div>
      )}
    </section>
  );
}
