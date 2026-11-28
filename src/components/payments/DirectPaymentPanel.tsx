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
  PROOF_KINDS,
  parseReconciliation,
  proofLine,
  reconFlagLabels,
  reconStateLabel,
  type Reconciliation,
  type ReconStage,
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
  recon: Reconciliation | null; // null before 0188
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
      recon: null,
    };
  }
  const { data: rows } = await db.from("direct_payment_stages").select("*").eq("job_id", jobId);
  const { data: hist } = await db
    .from("direct_payment_stage_events")
    .select("stage, action, amount, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  const recon = await rpc("job_payment_reconciliation", { _job: jobId });
  return {
    plan: parsePlan(plan.data),
    records: parseStageRecords(rows),
    history: (hist ?? []) as HistoryRow[],
    legacy: confError ? null : parseConfirmation(conf),
    dispute: disputeState(disputes),
    recon: recon.error ? null : parseReconciliation(recon.data),
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
      {role === "customer" ? (
        <div className="space-y-1 text-cz-muted" data-testid="direct-payment-guidance">
          <p>
            Payment is made directly to your assigned driver using the agreed payment method. Con Z
            does not receive, hold or guarantee this money.
          </p>
          <p className="font-semibold text-cz-text">
            Check the recipient and payment details before sending money.
          </p>
          <p>
            After paying, record the payment here. Your driver will be asked to confirm receipt, and
            you can acknowledge that confirmation.
          </p>
          <p>
            Con Z records the statements made by both of you. A payment record is not independent
            proof that a bank or mobile-money transfer settled.
          </p>
        </div>
      ) : (
        <p className="text-cz-muted" data-testid="direct-payment-guidance">
          The customer pays you directly using the agreed payment method. Con Z does not receive,
          hold or guarantee this money. Confirm only money you have actually received.
        </p>
      )}
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
          {data.recon?.simulated && (
            <p
              className="rounded bg-muted px-2 py-1 text-xs font-semibold"
              data-testid="payment-simulated"
            >
              Simulated sample data from the local stand-in. Not a real record.
            </p>
          )}
          {data.recon && (
            <p className="text-cz-muted" data-testid="payment-outstanding">
              Agreed ${Number(data.recon.totals.agreed).toFixed(2)} · driver confirmed $
              {Number(data.recon.totals.received_by_driver).toFixed(2)} · outstanding $
              {Number(data.recon.totals.outstanding).toFixed(2)}
              {data.recon.totals.under_review ? " · some payments are under review" : ""}
            </p>
          )}
          {data.plan.map((p) => (
            <StageCard
              key={p.stage}
              recon={data.recon?.stages.find((x) => x.stage === p.stage) ?? null}
              onAttach={async (kind, file) => {
                const { data: u } = await supabase.auth.getUser();
                const uid = u.user?.id;
                if (!uid) return false;
                const path = `${jobId}/${uid}/payment-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
                const up = await supabase.storage
                  .from("chat-media")
                  .upload(path, file, { contentType: file.type || undefined });
                if (up.error) {
                  toast.error(up.error.message);
                  return false;
                }
                return save(
                  "attach_stage_payment_evidence",
                  { _job: jobId, _stage: p.stage, _kind: kind, _storage_path: path },
                  "Proof attached. It is kept with this payment.",
                );
              }}
              onFlag={(action, reason) =>
                save(
                  "flag_stage_payment",
                  { _job: jobId, _stage: p.stage, _action: action, _reason: reason },
                  "Reported. The other person and Con Z have been told.",
                )
              }
              jobId={jobId}
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
  recon,
  onAttach,
  onFlag,
  jobId,
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
  jobId: string;
  plan: PlannedStage;
  rec: PaymentStageRecord | null;
  dispute: DisputeState;
  role: "driver" | "customer";
  active: boolean;
  busy: boolean;
  onClaim: (m: string, a: number, r: string | null) => Promise<boolean>;
  onConfirm: (m: string, a: number, r: string | null) => Promise<boolean>;
  onAcknowledge: () => Promise<boolean>;
  recon: ReconStage | null;
  onAttach: (kind: string, file: File) => Promise<boolean>;
  onFlag: (action: "disputed" | "reversal_reported", reason: string) => Promise<boolean>;
}) {
  const status = stageStatus(rec, dispute);
  const [proofKind, setProofKind] = useState("screenshot");
  const recorded = !!(rec?.customerClaimedAt || rec?.driverConfirmedAt);
  const flag = (action: "disputed" | "reversal_reported") => {
    const reason = window.prompt(
      action === "disputed"
        ? "What is wrong with this payment? (at least 10 characters)"
        : "What was reversed, and when? (at least 10 characters)",
    );
    if (reason && reason.trim().length >= 10) void onFlag(action, reason.trim());
    else if (reason) toast.error("Please give a little more detail (at least 10 characters).");
  };
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
          {recon ? reconStateLabel(recon.state) : stageStatusLabel(status)}
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
      {role === "customer" && rec?.customerClaimedAt && !rec.driverConfirmedAt && (
        <p className="text-cz-muted" data-testid="awaiting-driver-confirmation">
          Waiting for the driver to confirm they received it. If they do not, message them in the
          job chat. If the payment went to the wrong person or something is not right,{" "}
          <a
            className="font-semibold underline"
            href={`/report?jobId=${encodeURIComponent(jobId)}&category=payment`}
          >
            report it
          </a>
          .
        </p>
      )}
      {recon && proofLine(recon) && (
        <p className="text-cz-muted" data-testid="payment-proof-line">
          {proofLine(recon)}
        </p>
      )}
      {recon &&
        reconFlagLabels(recon.flags).map((f) => (
          <p key={f} className="text-warning">
            {f}
          </p>
        ))}
      {recon && active && recorded && (
        <div className="flex flex-wrap items-center gap-2" data-testid="payment-stage-actions">
          <label className="sr-only" htmlFor={`proof-kind-${plan.stage}`}>
            Kind of proof
          </label>
          <select
            id={`proof-kind-${plan.stage}`}
            value={proofKind}
            onChange={(e) => setProofKind(e.target.value)}
            className="h-9 rounded-md border bg-background px-2"
          >
            {PROOF_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <label className="cursor-pointer rounded-xl border px-3 py-1.5 font-semibold">
            Attach proof
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onAttach(proofKind, f);
                e.target.value = "";
              }}
            />
          </label>
          {recon.state !== "disputed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => flag("disputed")}
              className="rounded-xl border px-3 py-1.5 font-semibold"
            >
              Report a problem
            </button>
          )}
          {recon.state !== "reversal_reported" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => flag("reversal_reported")}
              className="rounded-xl border px-3 py-1.5 font-semibold"
            >
              Report a reversal
            </button>
          )}
        </div>
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
