import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { CzButton } from "@/components/redesign";
import {
  initiatePayonifyEscrowPayment,
  refreshPayonifyPayment,
  type PayonifyPaymentState,
} from "@/lib/payonify.functions";
import { friendlyPaymentError } from "@/lib/paymentErrors";

// Con Z Pay through EcoCash (Payonify, TEST MODE). Shown only to listed tester accounts
// (payonifyAvailability). The screen never decides a payment is paid: it shows what the
// server reports, and "paid" only after the server applied Payonify's own record.

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "pending"; paymentId: string; checking: boolean; note?: string }
  | { kind: "closed"; state: "failed" | "cancelled"; message: string }
  | { kind: "error"; message: string; paymentId?: string };

const POLL_EVERY_MS = 6_000;
const POLL_FOR_MS = 3 * 60_000;

export function PayonifyEscrowPay({
  jobId,
  totalLabel,
  onPaid,
}: {
  jobId: string;
  totalLabel: string;
  onPaid: () => void;
}) {
  const start = useServerFn(initiatePayonifyEscrowPayment);
  const refresh = useServerFn(refreshPayonifyPayment);
  const [number, setNumber] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = useRef(false); // blocks a double tap before React re-renders

  const settle = (state: PayonifyPaymentState, paymentId: string) => {
    if (state === "paid") return onPaid();
    if (state === "failed" || state === "cancelled")
      return setPhase({
        kind: "closed",
        state,
        message:
          state === "failed"
            ? "The EcoCash payment didn't go through. Nothing was taken. You can try again."
            : "The EcoCash payment was cancelled. Nothing was taken. You can try again.",
      });
    setPhase({ kind: "pending", paymentId, checking: false });
  };

  const pay = async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase({ kind: "starting" });
    try {
      const res = await start({ data: { jobId, mobileNumber: number } });
      if (res.ok) settle(res.state, res.paymentId);
      else if (res.error === "already_paid") onPaid();
      else if (res.error === "payment_status_unknown" && res.paymentId)
        setPhase({
          kind: "pending",
          paymentId: res.paymentId,
          checking: false,
          note: friendlyPaymentError(res.error),
        });
      else
        setPhase({
          kind: "error",
          message: friendlyPaymentError(res.error),
          paymentId: res.paymentId,
        });
    } catch (err) {
      setPhase({
        kind: "error",
        message: friendlyPaymentError(err, "Could not start payment. Please try again."),
      });
    } finally {
      busy.current = false;
    }
  };

  const check = async (paymentId: string) => {
    if (busy.current) return;
    busy.current = true;
    setPhase((p) => (p.kind === "pending" ? { ...p, checking: true } : p));
    try {
      const res = await refresh({ data: { paymentId } });
      settle(res.state === "unknown" ? "pending" : res.state, paymentId);
    } catch {
      setPhase({
        kind: "pending",
        paymentId,
        checking: false,
        note: "Couldn't check just now. Try again in a moment.",
      });
    } finally {
      busy.current = false;
    }
  };

  // While waiting for the customer to approve on their phone, check now and then.
  const pendingId = phase.kind === "pending" ? phase.paymentId : null;
  useEffect(() => {
    if (!pendingId) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) return clearInterval(t);
      void check(pendingId);
    }, POLL_EVERY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the attempt changes
  }, [pendingId]);

  if (phase.kind === "pending") {
    return (
      <div className="space-y-2.5" role="status" aria-live="polite">
        <div className="rounded-xl border border-cz-border bg-cz-surface px-4 py-3 text-sm">
          <div className="font-semibold">Approve the payment on your phone</div>
          <div className="text-cz-muted">
            EcoCash will ask you to confirm {totalLabel} with your PIN. This page updates once
            EcoCash confirms it.
          </div>
          {phase.note && <div className="mt-1.5 text-cz-muted">{phase.note}</div>}
        </div>
        <CzButton kind="ghost" onClick={() => check(phase.paymentId)} disabled={phase.checking}>
          {phase.checking ? <Loader2 className="w-5 h-5 animate-spin" /> : "Check status"}
        </CzButton>
      </div>
    );
  }

  const starting = phase.kind === "starting";
  return (
    <div className="space-y-2.5">
      <label className="block text-sm">
        <span className="font-semibold">EcoCash number</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="077 123 4567"
          disabled={starting}
          className="mt-1 block w-full rounded-xl border border-cz-border bg-cz-bg px-4 py-3 text-base"
        />
      </label>
      {(phase.kind === "closed" || phase.kind === "error") && (
        <p className="text-sm text-cz-danger-text" role="alert">
          {phase.message}
        </p>
      )}
      <CzButton onClick={pay} disabled={starting || number.replace(/\D/g, "").length < 9}>
        {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : `Pay ${totalLabel} with EcoCash`}
      </CzButton>
    </div>
  );
}
