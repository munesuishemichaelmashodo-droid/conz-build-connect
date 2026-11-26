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
  dueLabel,
  parseConfirmation,
  parsePlan,
  parseStageRecords,
  stageAmountsDisagree,
  stageName,
  stageStatus,
  stageStatusLabel,
  type DirectPaymentConfirmation,
  type DisputeState,
  type PaymentStageName,
  type PaymentStageRecord,
  type PlannedStage,
} from "@/lib/direct-payment";

// Direct-pay jobs: the customer pays the driver; Con Z never handles the fare. This panel shows what the two parties
// agreed and what each of them says happened, per payment stage (0179: deposit + balance, or one full payment).
// Each statement is saved once and never edited; nothing here is proof of settlement.
// Before 0179 is applied it falls back to the 0176 view: the driver's single confirmation.

type HistoryRow = { stage: string; action: string; amount: number | null; created_at: string };
type Loaded = {
  plan: PlannedStage[] | null; // null = 0179 not available
  records: PaymentStageRecord[];
  history: HistoryRow[];
  legacy: DirectPaymentConfirmation | null;
  dispute: DisputeState;
};

type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as RpcFn)(fn, args);

async function load(jobId: string): Promise<Loaded | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0176/0179 objects are newer than the generated types
  const db = supabase as any;
  const { data: conf, error: confError } = await db
    .from("direct_payment_confirmations")
    .select("method, amount, agreed_amount, reference, confirmed_at")
    .eq("job_id", jobId)
    .maybeSingle();
  const plan = await rpc("job_payment_plan", { _job: jobId });
  const { data: disputes } = await db.from("disputes").select("status").eq("job_id", jobId);
  if (plan.error) {
    if (confError) return null; // neither 0176 nor 0179: show nothing
    return {
      plan: null,
      records: [],
      history: [],
      legacy: parseConfirmation(conf),
      dispute: disputeState(disputes),
    };
  }
  const { data: rows } = await db.from("direct_payment_stages").select("*").eq("job_id", jobId);
  const { data: hist } = await db
    .from("direct_payment_stage_events")
    .select("stage, action, amount, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  return {
    plan: parsePlan(plan.data),
    records: parseStageRecords(rows),
    history: (hist ?? []) as HistoryRow[],
    legacy: confError ? null : parseConfirmation(conf),
    dispute: disputeState(disputes),
  };
}

const ACTION_LABEL: Record<string, string> = {
  customer_claimed: "Customer said they paid",
  driver_confirmed: "Driver confirmed receiving",
  customer_acknowledged: "Customer agreed with the driver",
};

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
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const active = ["accepted", "in_progress", "completed"].includes(jobStatus);

  const save = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) {
      toast.error(error.message || "Could not save.");
      return false;
    }
    toast.success(ok);
    await qc.invalidateQueries({ queryKey: key });
    return true;
  };

  return (
    <div
      className="space-y-3 rounded-2xl border border-cz-border p-4 text-[13px]"
      data-testid="direct-payment-panel"
    >
      <div className="flex justify-between">
        <span className="text-cz-muted">Agreed price</span>
        <span className="font-semibold tabular-nums">${agreedPrice.toFixed(2)}</span>
      </div>
      <p className="text-cz-muted">
        Paid directly to the driver. Con Z does not receive, hold or guarantee this money. Pay only
        this job's driver, using the details in the agreement.
      </p>
      <div className="flex justify-between">
        <span className="text-cz-muted">Disputes</span>
        <span>{disputeLabel(data.dispute)}</span>
      </div>

      {data.plan === null ? (
        <LegacyView
          confirmation={data.legacy}
          canConfirm={role === "driver" && !data.legacy && active}
          agreedPrice={agreedPrice}
          busy={busy}
          onConfirm={(m, a, r) =>
            save(
              "driver_confirm_direct_payment",
              { _job_id: jobId, _method: m, _amount: a, _reference: r },
              "Payment confirmation saved.",
            )
          }
        />
      ) : (
        <>
          {data.legacy && (
            <p className="text-cz-muted">{directPaymentStatusLine(data.legacy, true)}</p>
          )}
          {data.plan.map((p) => (
            <StageCard
              key={p.stage}
              plan={p}
              rec={data.records.find((r) => r.stage === p.stage) ?? null}
              dispute={data.dispute}
              role={role}
              active={active}
              busy={busy}
              onClaim={(m, a, r) =>
                save(
                  "customer_claim_stage_payment",
                  { _job: jobId, _stage: p.stage, _method: m, _amount: a, _reference: r },
                  "Saved. Your driver has been asked to confirm.",
                )
              }
              onConfirm={(m, a, r) =>
                save(
                  "driver_confirm_stage_payment",
                  { _job: jobId, _stage: p.stage, _method: m, _amount: a, _reference: r },
                  "Saved. The customer has been told.",
                )
              }
              onAcknowledge={() =>
                save(
                  "customer_acknowledge_stage_payment",
                  { _job: jobId, _stage: p.stage },
                  "Thanks. Saved.",
                )
              }
            />
          ))}
          {data.history.length > 0 && (
            <details>
              <summary className="cursor-pointer text-cz-muted">Payment history</summary>
              <ol className="mt-2 space-y-1" data-testid="direct-payment-history">
                {data.history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.created_at).toLocaleString()} ·{" "}
                    {stageName(h.stage as PaymentStageName)} · {ACTION_LABEL[h.action] ?? h.action}
                    {h.amount != null ? ` · $${Number(h.amount).toFixed(2)}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function StageCard({
  plan,
  rec,
  dispute,
  role,
  active,
  busy,
  onClaim,
  onConfirm,
  onAcknowledge,
}: {
  plan: PlannedStage;
  rec: PaymentStageRecord | null;
  dispute: DisputeState;
  role: "driver" | "customer";
  active: boolean;
  busy: boolean;
  onClaim: (m: string, a: number, r: string | null) => Promise<boolean>;
  onConfirm: (m: string, a: number, r: string | null) => Promise<boolean>;
  onAcknowledge: () => Promise<boolean>;
}) {
  const status = stageStatus(rec, dispute);
  const canClaim = role === "customer" && active && !rec?.customerClaimedAt;
  const canConfirm = role === "driver" && active && !rec?.driverConfirmedAt;
  const canAck =
    role === "customer" &&
    !!rec?.driverConfirmedAt &&
    !rec.customerAcknowledgedAt &&
    dispute !== "open";
  return (
    <section
      className="space-y-1.5 rounded-xl border border-cz-border p-3"
      data-testid={`payment-stage-${plan.stage}`}
    >
      <div className="flex justify-between gap-3">
        <span className="font-semibold">
          {stageName(plan.stage)} · ${plan.expectedAmount.toFixed(2)}
        </span>
        <span className="text-right" data-testid="payment-stage-status">
          {stageStatusLabel(status)}
        </span>
      </div>
      <p className="text-cz-muted">
        Due {dueLabel(plan.due)}
        {plan.methodAgreed ? ` by ${directMethodLabel(plan.methodAgreed)}` : ""}.
        {plan.recipientAccount || plan.recipientName
          ? ` Pay to ${[plan.recipientName, plan.recipientAccount].filter(Boolean).join(", ")}.`
          : ""}
        {plan.instructions ? ` ${plan.instructions}` : ""}
      </p>
      {rec?.customerClaimedAt && (
        <p>
          Customer says they paid ${rec.customerAmount?.toFixed(2)} by{" "}
          {directMethodLabel(rec.customerMethod)}
          {rec.customerReference ? `, reference ${rec.customerReference}` : ""} on{" "}
          {new Date(rec.customerClaimedAt).toLocaleString()}.
        </p>
      )}
      {rec?.driverConfirmedAt && (
        <p>
          Driver confirmed receiving ${rec.driverAmount?.toFixed(2)} by{" "}
          {directMethodLabel(rec.driverMethod)}
          {rec.driverReference ? `, reference ${rec.driverReference}` : ""} on{" "}
          {new Date(rec.driverConfirmedAt).toLocaleString()}.
        </p>
      )}
      {stageAmountsDisagree(rec) && (
        <p className="text-destructive">
          The amounts recorded do not match what was agreed. Con Z has been told. If this is not a
          mistake, raise a dispute.
        </p>
      )}
      {canAck && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onAcknowledge()}
          className="rounded-xl bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"
        >
          Yes, that is what I paid
        </button>
      )}
      {canClaim && (
        <StatementForm
          title={`Tell us you paid the ${plan.stage === "full" ? "driver" : stageName(plan.stage).toLowerCase()}`}
          amountLabel="Amount you paid (USD)"
          submitLabel="I paid"
          defaultAmount={plan.expectedAmount}
          defaultMethod={plan.methodAgreed}
          note="This records what you say you paid. It is not proof of payment and cannot be changed later."
          busy={busy}
          onSubmit={onClaim}
        />
      )}
      {canConfirm && (
        <StatementForm
          title={`Confirm you received the ${plan.stage === "full" ? "payment" : stageName(plan.stage).toLowerCase()}`}
          amountLabel="Amount you received (USD)"
          submitLabel="I received it"
          defaultAmount={plan.expectedAmount}
          defaultMethod={plan.methodAgreed}
          note="This records your own confirmation. It cannot be changed later; if something is wrong, raise a dispute."
          busy={busy}
          onSubmit={onConfirm}
        />
      )}
    </section>
  );
}

function StatementForm({
  title,
  amountLabel,
  submitLabel,
  defaultAmount,
  defaultMethod,
  note,
  busy,
  onSubmit,
}: {
  title: string;
  amountLabel: string;
  submitLabel: string;
  defaultAmount: number;
  defaultMethod: string | null;
  note: string;
  busy: boolean;
  onSubmit: (m: string, a: number, r: string | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(
    defaultMethod && (DIRECT_PAYMENT_METHODS as readonly string[]).includes(defaultMethod)
      ? defaultMethod
      : "",
  );
  const [amount, setAmount] = useState(defaultAmount > 0 ? defaultAmount.toFixed(2) : "");
  const [reference, setReference] = useState("");
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border px-3 py-1.5 font-semibold"
      >
        {title}
      </button>
    );
  return (
    <div className="space-y-2 border-t border-cz-border pt-2">
      <div className="font-semibold">{title}</div>
      <label className="block">
        <span className="text-cz-muted">Method</span>
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
        <span className="text-cz-muted">{amountLabel}</span>
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
      <p className="text-cz-muted">{note}</p>
      <button
        type="button"
        disabled={busy || !method || !(Number(amount) > 0)}
        onClick={async () => {
          if (await onSubmit(method, Number(amount), reference.trim() || null)) setOpen(false);
        }}
        className="rounded-xl bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

function LegacyView({
  confirmation,
  canConfirm,
  agreedPrice,
  busy,
  onConfirm,
}: {
  confirmation: DirectPaymentConfirmation | null;
  canConfirm: boolean;
  agreedPrice: number;
  busy: boolean;
  onConfirm: (m: string, a: number, r: string | null) => Promise<boolean>;
}) {
  return (
    <>
      <p className="text-cz-muted">{directPaymentStatusLine(confirmation, true)}</p>
      {canConfirm && (
        <StatementForm
          title="Confirm you received the customer's payment"
          amountLabel="Amount you received (USD)"
          submitLabel="Confirm payment received"
          defaultAmount={agreedPrice}
          defaultMethod={null}
          note="This records your own confirmation. It cannot be changed later; if something is wrong, raise a dispute."
          busy={busy}
          onSubmit={onConfirm}
        />
      )}
    </>
  );
}
