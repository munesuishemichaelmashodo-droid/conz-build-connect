import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { initiatePaynowTopup, reconcilePendingPaynowPayments } from "@/lib/paynow.functions";
import { friendlyPaymentError, topupAmountError } from "@/lib/paymentErrors";
import {
  Wallet as WalletIcon,
  Fuel,
  Plus,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Zap,
  Building2,
  Smartphone,
  CreditCard,
  Clock,
  X,
  Banknote,
  Loader2,
} from "lucide-react";
import { money } from "@/lib/domain";
import { EmptyState } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { rpcFailure } from "@/lib/rpc-result";
import { useLaunchSwitches } from "@/lib/launch-switches";
import { toast } from "sonner";
import { withdrawalStage } from "@/lib/withdrawalStatus";

export const Route = createFileRoute("/_authenticated/wallet")({
  component: WalletPage,
});

const METHODS = [
  { id: "ecocash", label: "EcoCash", hint: "Instant", icon: Smartphone },
  { id: "onemoney", label: "OneMoney", hint: "Instant", icon: Smartphone },
  { id: "zipit", label: "ZIPIT", hint: "Instant", icon: CreditCard },
  { id: "bank", label: "Bank Transfer", hint: "1–5 min", icon: Building2 },
] as const;

type TopupReq = {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  status: string;
  reject_reason: string | null;
  created_at: string;
};

type PaynowTopup = {
  id: string;
  amount: number;
  status: string;
  paid_at: string | null;
  created_at: string;
};

// Withdrawal payouts are manual: "approved" means the request was accepted and
// the amount was debited from the wallet. It does NOT mean money has arrived.
const WITHDRAWAL_STATUS: Record<string, { label: string; note?: string }> = {
  pending: { label: "Awaiting review", note: "An admin has not reviewed this yet. The amount is reserved so it cannot be spent elsewhere; cancel to release it." },
  approved: {
    label: "Approved · payout pending",
    note: "Debited from your wallet. ConZ sends the payout manually — this is not confirmation that money has arrived.",
  },
  rejected: { label: "Rejected" },
  cancelled: { label: "Cancelled" },
  failed: { label: "Payout failed · money returned", note: "The payout could not be sent. The amount is back in your wallet." },
};
const TOPUP_STATUS: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const PAYNOW_STATUS: Record<string, string> = {
  initiated: "Awaiting payment",
  paid: "Confirmed",
  released: "Confirmed",
  failed: "Payment failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  refund_due: "Refund due",
};

type WithdrawReq = {
  id: string;
  amount: number;
  method: string;
  destination: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
  // Set only when an admin records the manual transfer (migration 0094).
  paid_at?: string | null;
  payout_reference?: string | null;
};

function WalletPage() {
  const { userId, is } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"summary" | "history" | "requests">("summary");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const launch = useLaunchSwitches();
  const canWithdraw = launch.withdrawalsEnabled;

  const { data: wallet } = useQuery({
    queryKey: ["wallet", userId],
    enabled: !!userId,
    queryFn: async () => (await supabase.from("wallets").select("*").eq("user_id", userId!).maybeSingle()).data,
  });
  const { data: txs } = useQuery({
    queryKey: ["wallet-tx", userId],
    enabled: !!userId,
    queryFn: async () =>
      (await supabase.from("wallet_transactions").select("*").eq("user_id", userId!).order("created_at", { ascending: false }).limit(50)).data ?? [],
  });
  const { data: topups } = useQuery({
    queryKey: ["topups", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("wallet_topup_requests")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(30);
      return (data ?? []) as TopupReq[];
    },
  });
  const { data: withdrawals } = useQuery({
    queryKey: ["withdrawals", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("wallet_withdrawal_requests")
        .select("*")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(30);
      return (data ?? []) as WithdrawReq[];
    },
  });
  const { data: paynowTopups } = useQuery({
    queryKey: ["paynow-topups", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payments")
        .select("id,amount,status,paid_at,created_at")
        .eq("user_id", userId!)
        .eq("type", "topup")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as PaynowTopup[];
    },
  });
  // Only whether a PIN exists is needed — filter server-side so the bcrypt
  // hash itself is never sent to the browser.
  const { data: hasPin, isLoading: pinLoading } = useQuery({
    queryKey: ["driver-pin", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_profiles")
        .select("user_id")
        .eq("user_id", userId!)
        .not("withdrawal_pin_hash", "is", null)
        .maybeSingle();
      return !!data;
    },
  });

  // Reconcile any pending Paynow top-ups by polling Paynow directly — the
  // resultUrl webhook is not always reliably delivered (especially in test
  // mode), so this is the primary confirmation path: check whenever the
  // wallet page mounts or regains focus (e.g. returning from Paynow's site).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const reconcile = async () => {
      try {
        const res = await reconcilePendingPaynowPayments();
        if (!cancelled && res.credited > 0) {
          qc.invalidateQueries({ queryKey: ["wallet", userId] });
          qc.invalidateQueries({ queryKey: ["wallet-tx", userId] });
          qc.invalidateQueries({ queryKey: ["topups", userId] });
          qc.invalidateQueries({ queryKey: ["paynow-topups", userId] });
          toast.success(res.credited === 1 ? "Payment confirmed — wallet credited!" : `${res.credited} payments confirmed — wallet credited!`);
        }
      } catch {
        // Silent — realtime/webhook path can still catch it later.
      }
    };
    reconcile();
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", reconcile);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", reconcile);
    };
  }, [userId, qc]);

  // Realtime — refresh on any wallet change
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`wallet-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["wallet", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["wallet-tx", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_topup_requests", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["topups", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_withdrawal_requests", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["withdrawals", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["paynow-topups", userId] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);

  if (!is("driver"))
    return (
      <AppShell title="Wallet">
        <EmptyState icon={WalletIcon} title="Wallet is for drivers" hint="Switch to a driver account from your profile." />
      </AppShell>
    );

  // Figures come from the wallets row; available = balance - held - reserved (the same
  // rule the database enforces on withdrawals and approvals).
  const balance = Number(wallet?.balance ?? 0);
  const held = Number((wallet as any)?.held ?? 0);
  const reserved = Number((wallet as any)?.withdrawal_reserved ?? 0); // pending withdrawals (0095)
  const available = Math.max(0, Math.round((balance - held - reserved) * 100) / 100);
  const pendingWithdrawal = (withdrawals ?? [])
    .filter((w) => w.status === "pending")
    .reduce((sum, w) => sum + Number(w.amount), 0);
  const limited = !!(wallet as any)?.limited;
  const noFunds = available <= 0;

  const status = noFunds
    ? { label: "No available funds", tone: "text-destructive", dot: "bg-destructive", ring: "stroke-destructive" }
    : limited
    ? { label: "Limited — top up for larger jobs", tone: "text-warning", dot: "bg-warning", ring: "stroke-warning" }
    : { label: "Healthy balance", tone: "text-success", dot: "bg-success", ring: "stroke-success" };

  const isCommission = (t: { type: unknown }) => String(t.type).includes("commission");
  const isWithdrawal = (t: { type: unknown }) => String(t.type).includes("withdraw");
  const credits = (txs ?? []).filter((t) => Number(t.amount) > 0).reduce((sum, t) => sum + Number(t.amount), 0);
  const commissions = (txs ?? [])
    .filter((t) => isCommission(t) && Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const withdrawn = (txs ?? [])
    .filter((t) => isWithdrawal(t) && Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const jobsCompleted = (txs ?? []).filter((t) => isCommission(t) && Number(t.amount) < 0).length;
  const pendingCount = (topups ?? []).filter((t) => t.status === "pending").length +
    (withdrawals ?? []).filter((t) => t.status === "pending").length;

  return (
    <AppShell title="Driver Wallet">
      <motion.div
        id="tour-wallet-balance"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-dark text-white p-6 shadow-lift"
      >
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="flex items-start justify-between relative">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-white/75">{canWithdraw ? "Available to withdraw" : "ConZ credit available"}</div>
            <div className="font-display font-bold text-primary text-5xl mt-1 tracking-tight" aria-label={`Available balance ${money(available)}`}>{money(available)}</div>
            <div className={cn("inline-flex items-center gap-1.5 mt-3 text-xs font-semibold", status.tone)}>
              <span className={cn("w-2 h-2 rounded-full", status.dot)} />
              {status.label}
            </div>
          </div>
          <Gauge pct={balance > 0 ? available / balance : 0} ring={status.ring} />
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2 relative text-center">
          <div className="rounded-xl bg-white/5 py-2">
            <dt className="text-xs uppercase tracking-wider text-white/75">Total</dt>
            <dd className="font-display font-bold text-sm">{money(balance)}</dd>
          </div>
          <div className="rounded-xl bg-white/5 py-2">
            <dt className="text-xs uppercase tracking-wider text-white/75">Held</dt>
            <dd className="font-display font-bold text-sm">{money(held)}</dd>
          </div>
          <div className="rounded-xl bg-white/5 py-2">
            <dt className="text-xs uppercase tracking-wider text-white/75">Pending withdrawal</dt>
            <dd className="font-display font-bold text-sm">{money(pendingWithdrawal)}</dd>
          </div>
        </dl>

        <div className="mt-5 grid grid-cols-2 gap-2 relative">
          <Button
            onClick={() => setTopUpOpen(true)}
            className={cn("h-11 rounded-xl font-display uppercase tracking-wide", !canWithdraw && "col-span-2")}
          >
            <Plus className="w-4 h-4 mr-1" /> Top Up
          </Button>
          {canWithdraw && (
            <Button
              onClick={() => setWithdrawOpen(true)}
              variant="secondary"
              className="h-11 rounded-xl font-display uppercase tracking-wide bg-white/10 text-white hover:bg-white/20 border-white/10"
            >
              <Banknote className="w-4 h-4 mr-1" /> Withdraw
            </Button>
          )}
        </div>

        {!canWithdraw && (
          <p className="text-xs text-white/75 mt-4 relative">
            Your ConZ credit pays our 7% fee on jobs you complete. Part of it is held while a job is active. Withdrawals are paused for now;
            to get unused credit back, contact support. You can hold up to {money(launch.maxWalletBalance)} in credit.
          </p>
        )}
        {canWithdraw && (
        <p className="text-xs text-white/75 mt-4 relative">
          Held funds are the 7% commission reserved for your active jobs; they can't be withdrawn.
          A pending withdrawal is reserved straight away, so it is not counted as available; it is debited when an admin approves it, and released if it is rejected or cancelled.
        </p>
        )}
      </motion.div>

      <div className="mt-5 flex gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Wallet sections">
        {(["summary", "requests", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 min-h-11 rounded-lg text-xs font-display uppercase tracking-wide transition relative",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t === "summary" ? "Summary" : t === "requests" ? "Requests" : "History"}
            {t === "requests" && pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl bg-card border p-4 space-y-3">
            <SummaryRow label="Credits received" value={money(credits)} tone="text-success" hint="Top-ups, earnings and refunds (last 50 entries)" />
            <div className="h-px bg-border" />
            <SummaryRow label="Commission charged (7%)" value={money(commissions)} tone="text-destructive" />
            <div className="h-px bg-border" />
            <SummaryRow label="Approved withdrawals" value={money(withdrawn)} hint="Debited from your wallet; payout is sent manually" />
            <div className="h-px bg-border" />
            <SummaryRow label="Jobs with commission charged" value={String(jobsCompleted)} />
          </div>

          {noFunds && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="font-display font-bold uppercase text-xs tracking-wide">No available funds</div>
              <p className="text-[13px] mt-1 opacity-90">
                Your available balance is {money(available)}. Top up to cover the commission on new jobs.
              </p>
            </div>
          )}

          {!pinLoading && !hasPin && (
            <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
              <div className="font-display font-bold uppercase text-xs tracking-wide text-warning">Set a withdrawal PIN</div>
              <p className="text-[13px] mt-1 opacity-90">
                A 4–8 digit PIN protects your withdrawals. Set it from your Profile.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="mt-4 space-y-3">
          {(topups ?? []).length === 0 && (withdrawals ?? []).length === 0 && (paynowTopups ?? []).length === 0 ? (
            <EmptyState icon={Clock} title="No requests yet" hint="Your top-ups and withdrawals will appear here." />
          ) : (
            <>
              {(paynowTopups ?? []).map((p) => (
                <div key={p.id} className="rounded-2xl bg-card border p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-success/15 text-success">
                    <ArrowDownLeft className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Top Up · Paynow</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.paid_at ?? p.created_at).toLocaleString()} · {PAYNOW_STATUS[p.status] ?? p.status}
                    </div>
                    {p.status === "initiated" && (
                      <div className="text-xs text-muted-foreground">Your wallet is credited only once Paynow confirms payment.</div>
                    )}
                  </div>
                  <div className={cn("text-sm font-display font-bold", p.status === "paid" || p.status === "released" ? "text-success" : "text-muted-foreground")}>
                    {money(Number(p.amount))}
                  </div>
                </div>
              ))}
              {(topups ?? []).map((r) => (
                <RequestRow
                  key={r.id}
                  kind="topup"
                  amount={Number(r.amount)}
                  method={r.method}
                  reference={r.reference}
                  status={r.status}
                  rejectReason={r.reject_reason}
                  createdAt={r.created_at}
                  onCancel={async () => {
                    try {
                      const { error } = await (supabase as any).rpc("cancel_topup", { _id: r.id });
                      if (error) return void toast.error(friendlyPaymentError(error));
                      toast.success("Request cancelled");
                      qc.invalidateQueries({ queryKey: ["topups", userId] });
                    } catch (err) {
                      toast.error(friendlyPaymentError(err));
                    }
                  }}
                />
              ))}
              {(withdrawals ?? []).map((r) => (
                <RequestRow
                  key={r.id}
                  kind="withdrawal"
                  amount={Number(r.amount)}
                  method={r.method}
                  reference={r.destination}
                  status={r.status}
                  rejectReason={r.reject_reason}
                  createdAt={r.created_at}
                  paidAt={r.paid_at ?? null}
                  payoutReference={r.payout_reference ?? null}
                  onCancel={async () => {
                    try {
                      const { error } = await (supabase as any).rpc("cancel_withdrawal", { _id: r.id });
                      if (error) return void toast.error(friendlyPaymentError(error));
                      toast.success("Request cancelled — the reserved amount is available again.");
                      qc.invalidateQueries({ queryKey: ["withdrawals", userId] });
                      qc.invalidateQueries({ queryKey: ["wallet", userId] });
                    } catch (err) {
                      toast.error(friendlyPaymentError(err));
                    }
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="mt-4">
          {!txs?.length ? (
            <EmptyState icon={WalletIcon} title="No transactions yet" hint="Your top-ups and commissions will appear here." />
          ) : (
            <div className="space-y-2">
              {txs.map((t) => {
                const positive = Number(t.amount) >= 0;
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-card border p-3">
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                        positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {positive ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold capitalize truncate">{String(t.type).replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.note ?? new Date(t.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className={cn("font-display font-bold text-sm", positive ? "text-success" : "text-destructive")}>
                      {positive ? "+" : ""}
                      {money(Number(t.amount))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} />
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        available={available}
        hasPin={!!hasPin}
      />
    </AppShell>
  );
}

function RequestRow({
  kind,
  amount,
  method,
  reference,
  status,
  rejectReason,
  createdAt,
  paidAt,
  payoutReference,
  onCancel,
}: {
  kind: "topup" | "withdrawal";
  amount: number;
  method: string;
  reference: string | null;
  status: string;
  rejectReason: string | null;
  createdAt: string;
  paidAt?: string | null;
  payoutReference?: string | null;
  onCancel: () => void | Promise<void>;
}) {
  const isTopup = kind === "topup";
  const [cancelling, setCancelling] = useState(false);
  const stage = withdrawalStage(status, paidAt);
  const paid = !isTopup && stage === "payout_recorded";
  const info: { label: string; note?: string } = isTopup
    ? { label: TOPUP_STATUS[status] ?? status }
    : paid
    ? {
        label: "Payout recorded as sent",
        note: `ConZ recorded the transfer on ${new Date(paidAt!).toLocaleDateString()}${payoutReference ? ` (ref ${payoutReference})` : ""}. If it hasn't arrived, contact support.`,
      }
    : WITHDRAWAL_STATUS[status] ?? { label: status };
  const statusTone: Record<string, string> = {
    pending: "bg-warning/15 text-warning border-warning/30",
    approved: isTopup || paid ? "bg-success/15 text-success border-success/30" : "bg-primary/15 text-primary border-primary/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground border-border",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <div className="rounded-2xl bg-card border p-3">
      <div className="flex items-start gap-3">
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0",
          isTopup ? "bg-success/15 text-success" : "bg-primary/15 text-primary")}>
          {isTopup ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{isTopup ? "Top Up" : "Withdrawal"} · {method.toUpperCase()}</div>
            <div className={cn("text-sm font-display font-bold", isTopup ? "text-success" : "text-primary")}>
              {isTopup ? "+" : "−"}{money(amount)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {reference ? `Ref: ${reference} · ` : ""}{new Date(createdAt).toLocaleString()}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase", statusTone[status])}>
              <Clock className="w-3 h-3" /> {info.label}
            </span>
            {status === "pending" && (
              <button
                type="button"
                disabled={cancelling}
                onClick={async () => {
                  if (cancelling) return;
                  setCancelling(true);
                  try {
                    await onCancel();
                  } finally {
                    setCancelling(false);
                  }
                }}
                className="text-xs text-muted-foreground underline disabled:opacity-50 min-h-8 px-1"
              >
                {cancelling ? "Cancelling…" : "Cancel request"}
              </button>
            )}
          </div>
          {info.note && <div className="text-xs text-muted-foreground mt-1">{info.note}</div>}
          {(status === "rejected" || status === "failed") && rejectReason && (
            <div className="text-xs text-destructive mt-1">Reason: {rejectReason}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Gauge({ pct: raw, ring }: { pct: number; ring: string }) {
  const pct = Math.max(0.05, Math.min(1, raw));
  const c = 2 * Math.PI * 28;
  return (
    <div className="relative w-20 h-20 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r="28" className="stroke-white/10" strokeWidth="6" fill="none" />
        <circle cx="32" cy="32" r="28" className={cn(ring, "transition-all")} strokeWidth="6" fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Fuel className="w-6 h-6 text-primary" />
      </div>
    </div>
  );
}

function SummaryRow({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm text-foreground">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className={cn("font-display font-bold text-sm", tone)}>{value}</div>
    </div>
  );
}

function TopUpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [amount, setAmount] = useState<number>(50);
  const [submitting, setSubmitting] = useState(false);
  const presets = [10, 20, 50, 100];

  const submit = async () => {
    if (submitting) return;
    const invalid = topupAmountError(amount);
    if (invalid) return toast.error(invalid);
    setSubmitting(true);
    try {
      const res = await initiatePaynowTopup({ data: { amount } });
      if (!res.ok) {
        setSubmitting(false);
        return toast.error(friendlyPaymentError(res.error, "Could not start payment. Please try again."));
      }
      window.location.href = res.redirectUrl;
    } catch (err) {
      setSubmitting(false);
      toast.error(friendlyPaymentError(err, "Could not start payment. Please try again."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">Top Up Wallet</DialogTitle>
          <DialogDescription>Enter an amount — you'll be securely redirected to Paynow to complete payment.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl bg-muted p-4">
            <label htmlFor="topup-amount" className="text-xs uppercase tracking-widest text-muted-foreground">Enter Amount</label>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-display font-bold text-3xl">$</span>
              <input
                id="topup-amount"
                type="number"
                inputMode="decimal"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="bg-transparent font-display font-bold text-3xl w-full outline-none"
              />
            </div>
            <div className="mt-3 flex gap-1.5">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p)}
                  className={cn(
                    "flex-1 h-9 rounded-lg text-xs font-display font-bold border transition",
                    amount === p ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/40",
                  )}
                >
                  ${p}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-[12px] text-muted-foreground leading-snug">
              Pay via <span className="font-semibold text-foreground">EcoCash, OneMoney, ZIPIT, bank transfer, Visa or Mastercard</span> on Paynow's secure checkout.
            </div>
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full h-12 rounded-xl font-display uppercase tracking-wide">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Pay with Paynow — {money(amount || 0)}</>}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Your wallet is credited automatically once payment is confirmed.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({
  open,
  onOpenChange,
  available,
  hasPin,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  available: number;
  hasPin: boolean;
}) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [amountText, setAmountText] = useState("20");
  const [method, setMethod] = useState<string>("ecocash");
  const [destination, setDestination] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  const amount = Number(amountText);
  const errors: { amount?: string; destination?: string; pin?: string } = {};
  if (!amountText || !Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount greater than $0.";
  else if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6)
    errors.amount = "Use at most 2 decimal places.";
  else if (amount > available) errors.amount = `You can withdraw at most ${money(available)} (held funds can't be withdrawn).`;
  if (destination.trim().length < 5) errors.destination = "Enter the full phone number or account number.";
  if (pin.length < 4) errors.pin = "Enter your 4–8 digit PIN.";
  const valid = Object.keys(errors).length === 0;

  const reset = () => {
    setStep("form");
    setPin("");
    setTouched(false);
  };

  const submit = async () => {
    if (submitting) return; // guard against double taps
    if (!hasPin) return toast.error("Set a withdrawal PIN in Profile first");
    if (!valid) return;
    setSubmitting(true);
    try {
      const { data, error } = await (supabase as any).rpc("request_withdrawal", {
        _amount: amount,
        _method: method,
        _destination: destination.trim(),
        _pin: pin,
      });
      setPin("");
      if (error) {
        setStep("form");
        return toast.error(friendlyPaymentError(error));
      }
      const failed = rpcFailure(data);
      if (failed) {
        setStep("form");
        return toast.error(failed.message);
      }
      toast.success("Request submitted — awaiting admin review. No money has been sent yet.");
      qc.invalidateQueries({ queryKey: ["withdrawals", userId] });
      qc.invalidateQueries({ queryKey: ["wallet", userId] });
      setDestination("");
      reset();
      onOpenChange(false);
    } catch (err) {
      setStep("form");
      toast.error(friendlyPaymentError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const methodLabel = METHODS.find((m) => m.id === method)?.label ?? method;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (submitting) return;
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">
            {step === "form" ? "Withdraw" : "Confirm withdrawal"}
          </DialogTitle>
          <DialogDescription>
            {step === "form"
              ? "An admin reviews each request, then ConZ sends the payout manually. Submitting does not send money."
              : "Check the details. Once submitted you can't edit the request — only cancel it while it is awaiting review."}
          </DialogDescription>
        </DialogHeader>

        {step === "confirm" ? (
          <div className="space-y-4">
            <dl className="rounded-2xl bg-muted p-4 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Amount</dt><dd className="font-display font-bold">{money(amount)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Method</dt><dd className="font-semibold">{methodLabel}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Send to</dt><dd className="font-semibold break-all text-right">{destination.trim()}</dd></div>
            </dl>
            <p className="text-[12px] text-muted-foreground">
              The amount is debited from your wallet when an admin approves it, and paid out by ConZ afterwards. Payout timing is not guaranteed by this app.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={submitting} onClick={() => setStep("form")} className="h-12 rounded-xl">
                Back
              </Button>
              <Button type="button" disabled={submitting} onClick={submit} className="h-12 rounded-xl font-display uppercase tracking-wide">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-label="Submitting" /> : "Submit request"}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (valid && hasPin) setStep("confirm");
            }}
          >
            <div className="rounded-2xl bg-muted p-4">
              <div className="flex items-center justify-between">
                <label htmlFor="wd-amount" className="text-xs uppercase tracking-widest text-muted-foreground">Amount</label>
                <div className="text-xs text-muted-foreground">Available {money(available)}</div>
              </div>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="font-display font-bold text-3xl">$</span>
                <input
                  id="wd-amount"
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step="0.01"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  aria-invalid={touched && !!errors.amount}
                  aria-describedby={touched && errors.amount ? "wd-amount-err" : undefined}
                  className="bg-transparent font-display font-bold text-3xl w-full outline-none"
                />
              </div>
              <button type="button" onClick={() => setAmountText(String(available))} className="mt-2 text-xs underline text-muted-foreground min-h-8">
                Use full available amount
              </button>
              {touched && errors.amount && <p id="wd-amount-err" role="alert" className="text-xs text-destructive mt-1">{errors.amount}</p>}
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Payout Method</div>
              <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Payout method">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-2.5 text-left transition text-xs font-semibold min-h-11",
                      method === m.id ? "border-primary bg-primary/5" : "hover:border-primary/40",
                    )}
                  >
                    <m.icon className="w-4 h-4 text-primary" />
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="wd-dest" className="text-xs uppercase tracking-widest text-muted-foreground">Destination (phone / account)</label>
              <input
                id="wd-dest"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                maxLength={60}
                autoComplete="off"
                aria-invalid={touched && !!errors.destination}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border bg-background text-sm"
              />
              {touched && errors.destination && <p role="alert" className="text-xs text-destructive mt-1">{errors.destination}</p>}
            </div>

            <div>
              <label htmlFor="wd-pin" className="text-xs uppercase tracking-widest text-muted-foreground">Withdrawal PIN</label>
              <input
                id="wd-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                maxLength={8}
                placeholder="••••"
                aria-invalid={touched && !!errors.pin}
                className="w-full mt-1 px-3 py-2.5 rounded-xl border bg-background text-sm tracking-widest"
              />
              {touched && errors.pin && <p role="alert" className="text-xs text-destructive mt-1">{errors.pin}</p>}
              {!hasPin && (
                <p className="text-xs text-warning mt-1">You haven't set a PIN. Set one from Profile before withdrawing.</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Repeated wrong PINs lock withdrawals temporarily. There is no self-service PIN reset yet — contact support if you forget it.
              </p>
            </div>

            <Button type="submit" disabled={!hasPin || available <= 0} className="w-full h-12 rounded-xl font-display uppercase tracking-wide">
              Review withdrawal
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
