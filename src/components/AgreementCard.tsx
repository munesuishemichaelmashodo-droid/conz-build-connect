import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PAYMENT_METHODS,
  PAYMENT_TIMINGS,
  agreementView,
  currentAgreement,
  methodLabel,
  payLine,
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
}: {
  jobId: string;
  jobStatus: string;
  userId: string | null;
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
  const view = agreementView(current, userId);
  const open = ["accepted", "in_progress"].includes(jobStatus);
  const refresh = () => qc.invalidateQueries({ queryKey: ["job-agreements", jobId] });

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await call(fn, args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(ok);
    setEditing(false);
    refresh();
  };

  const propose = () =>
    run(
      "propose_job_agreement",
      {
        _job: jobId,
        _payment_method: method,
        _payment_timing: timing,
        _deposit_amount: Number(deposit) || 0,
        _pickup_window: pickup,
        _delivery_window: delivery,
        _inclusions: inc,
        _exclusions: exc,
      },
      "Sent. The other person will be asked to confirm.",
    );

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
          <p>{payLine(current)}</p>
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
              setMethod(current.payment_method);
              setTiming(current.payment_timing);
              setDeposit(current.deposit_amount ? String(current.deposit_amount) : "");
              setPickup(current.pickup_window ?? "");
              setDelivery(current.delivery_window ?? "");
              setInc(current.inclusions ?? "");
              setExc(current.exclusions ?? "");
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
          <label className="block text-sm">
            Deposit paid to the driver (USD, optional)
            <Input
              inputMode="decimal"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              placeholder="0"
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
