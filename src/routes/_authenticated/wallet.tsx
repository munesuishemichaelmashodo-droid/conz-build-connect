import { createFileRoute } from "@tanstack/react-router";
import { useTransportPricingEnabled } from "@/lib/transport-pricing";
import { commissionCopy } from "@/lib/commission-copy";
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
  Loader2,
} from "lucide-react";
import { money } from "@/lib/domain";
import { EmptyState } from "@/components/ui-bits";
import { Notice } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { rpcFailure } from "@/lib/rpc-result";
import { useLaunchSwitches } from "@/lib/launch-switches";
import { promoCopy, usePromoCredit } from "@/lib/promo-credit";
import { toast } from "sonner";
import { withdrawalStage } from "@/lib/withdrawalStatus";
import {
  COMMISSION_WALLET_RULES,
  COMMISSION_WALLET_TITLE,
  TOPUP_AVAILABILITY,
  topupReceiptLines,
  walletTxLabel,
  type TopupReceipt,
} from "@/lib/commission-wallet";

export const Route = createFileRoute("/_authenticated/wallet")({
  // ?topup=12.5 opens the top-up with that amount filled in (the shortfall shown on a job offer).
  validateSearch: (search: Record<string, unknown>): { topup?: number } => {
    const n = Number(search.topup);
    return Number.isFinite(n) && n > 0 && n <= 10000 ? { topup: Math.ceil(n) } : {};
  },
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
  currency?: string | null;
  paynow_reference?: string | null;
};

// Withdrawal payouts are manual: "approved" means the request was accepted and
// the amount was debited from the wallet. It does NOT mean money has arrived.
const WITHDRAWAL_STATUS: Record<string, { label: string; note?: string }> = {
  pending: {
    label: "Awaiting review",
    note: "An admin has not reviewed this yet. The amount is reserved so it cannot be spent elsewhere; cancel to release it.",
  },
  approved: {
    label: "Approved · payout pending",
    note: "Approved and taken from your balance. Con Z sends this payout manually; this does not confirm that the money has arrived.",
  },
  rejected: { label: "Rejected" },
  cancelled: { label: "Cancelled" },
  failed: {
    label: "Payout failed · money returned",
    note: "This old withdrawal could not be sent. The amount was returned to your balance.",
  },
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
  const transportOn = useTransportPricingEnabled();
  const { userId, is } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"summary" | "history" | "requests">("summary");
  const { topup: topupFromLink } = Route.useSearch();
  const [topUpOpen, setTopUpOpen] = useState(topupFromLink != null);
  const [receipt, setReceipt] = useState<TopupReceipt | null>(null);
  const launch = useLaunchSwitches();
  const promoCredit = usePromoCredit();

  const { data: wallet } = useQuery({
    queryKey: ["wallet", userId],
    enabled: !!userId,
    queryFn: async () =>
      (await supabase.from("wallets").select("*").eq("user_id", userId!).maybeSingle()).data,
  });
  const { data: txs } = useQuery({
    queryKey: ["wallet-tx", userId],
    enabled: !!userId,
    queryFn: async () =>
      (
        await supabase
          .from("wallet_transactions")
          .select("*")
          .eq("user_id", userId!)
          .order("created_at", { ascending: false })
          .limit(50)
      ).data ?? [],
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
        .select("id,amount,status,paid_at,created_at,currency,paynow_reference")
        .eq("user_id", userId!)
        .eq("type", "topup")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as PaynowTopup[];
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
          toast.success(
            res.credited === 1
              ? "Payment confirmed: commission credit added."
              : `${res.credited} payments confirmed: commission credit added.`,
          );
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["wallet", userId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wallet_transactions",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["wallet-tx", userId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wallet_topup_requests",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["topups", userId] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wallet_withdrawal_requests",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["withdrawals", userId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["paynow-topups", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);

  if (!is("driver"))
    return (
      <AppShell title="Commission credit">
        <EmptyState
          icon={WalletIcon}
          title="Commission credit is for drivers"
          hint="Switch to a driver account from your profile."
        />
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
  const promo = Number((wallet as any)?.promo_balance ?? 0); // promotional commission credit (0134), not cash
  const limited = !!(wallet as any)?.limited;
  const noFunds = available <= 0;

  const status = noFunds
    ? {
        label: "No available funds",
        tone: "text-destructive",
        dot: "bg-destructive",
        ring: "stroke-destructive",
      }
    : limited
      ? {
          label: "Limited — top up for larger jobs",
          tone: "text-warning",
          dot: "bg-warning",
          ring: "stroke-warning",
        }
      : {
          label: "Healthy balance",
          tone: "text-success",
          dot: "bg-success",
          ring: "stroke-success",
        };

  const isCommission = (t: { type: unknown }) => String(t.type).includes("commission");
  const isWithdrawal = (t: { type: unknown }) => String(t.type).includes("withdraw");
  const credits = (txs ?? [])
    .filter((t) => Number(t.amount) > 0)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const commissions = (txs ?? [])
    .filter((t) => isCommission(t) && Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const withdrawn = (txs ?? [])
    .filter((t) => isWithdrawal(t) && Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  const jobsCompleted = (txs ?? []).filter((t) => isCommission(t) && Number(t.amount) < 0).length;
  const pendingCount =
    (topups ?? []).filter((t) => t.status === "pending").length +
    (withdrawals ?? []).filter((t) => t.status === "pending").length;

  return (
    <AppShell title={COMMISSION_WALLET_TITLE}>
      <motion.div
        id="tour-wallet-balance"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl dark bg-gradient-dark text-white p-6 shadow-lift"
      >
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="flex items-start justify-between relative">
          <div>
            <div className="text-xs text-white/75">
              Commission credit available
            </div>
            <div
              className="font-display font-bold text-cz-amber-text text-5xl mt-1 tracking-tight"
              aria-label={`Available balance ${money(available)}`}
            >
              {money(available)}
            </div>
            <div
              className={cn(
                "inline-flex items-center gap-1.5 mt-3 text-xs font-semibold",
                status.tone,
              )}
            >
              <span className={cn("w-2 h-2 rounded-full", status.dot)} />
              {status.label}
            </div>
          </div>
          <Gauge pct={balance > 0 ? available / balance : 0} ring={status.ring} />
        </div>

        {/* Pending withdrawal only means something while withdrawals are switched on. */}
        <dl
          className={cn(
            "mt-4 grid gap-2 relative text-center",
            pendingWithdrawal > 0 ? "grid-cols-3" : "grid-cols-2",
          )}
        >
          <div className="rounded-xl bg-white/5 py-2">
            <dt className="text-xs text-white/75">Total credit</dt>
            <dd className="font-display font-bold text-sm">{money(balance)}</dd>
          </div>
          <div className="rounded-xl bg-white/5 py-2">
            <dt className="text-xs text-white/75">Reserved for active jobs</dt>
            <dd className="font-display font-bold text-sm">{money(held)}</dd>
          </div>
          {pendingWithdrawal > 0 && (
            <div className="rounded-xl bg-white/5 py-2">
              <dt className="text-xs text-white/75">Old withdrawal request</dt>
              <dd className="font-display font-bold text-sm">{money(pendingWithdrawal)}</dd>
            </div>
          )}
        </dl>
        {promo > 0 && (
          <p className="mt-3 relative rounded-xl bg-white/5 px-3 py-2 text-xs text-white/85">
            Promotional commission credit: <b>{money(promo)}</b>. It pays ConZ commission before
            your own money is used. It is not cash and cannot be withdrawn or transferred.
          </p>
        )}

        <div className="mt-5 relative">
          <Button onClick={() => setTopUpOpen(true)} className="h-11 w-full rounded-xl">
            <Plus className="w-4 h-4 mr-1" /> Top up commission credit
          </Button>
        </div>

        <p className="text-xs text-white/75 mt-4 relative">
          {commissionCopy("Prepaid credit used only to pay Con Z's commission: 7% of the total agreed job value: the delivery price when the driver only delivers, or materials and delivery together when the driver also supplies the materials.", transportOn)}{" "}
          It is not your earnings: customers pay you directly. It cannot be withdrawn or transferred. You can hold up to{" "}
          {money(launch.maxWalletBalance)} in credit.
        </p>
      </motion.div>

      <div
        className="mt-5 flex gap-1 rounded-xl bg-muted p-1"
        role="tablist"
        aria-label="Commission credit sections"
      >
        {(["summary", "requests", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 min-h-11 rounded-lg text-xs transition relative",
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
          <ul className="rounded-2xl border bg-card p-4 text-xs space-y-1.5 list-disc pl-8" aria-label="How commission credit works" data-testid="commission-rules">
            {COMMISSION_WALLET_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
            <li>{TOPUP_AVAILABILITY}</li>
          </ul>
          <dl className="rounded-2xl border bg-card p-4 text-xs space-y-1.5" aria-label="What the numbers mean">
            <div><dt className="inline font-semibold">Total credit: </dt><dd className="inline text-muted-foreground">your top-ups and promotional credit. It only pays ConZ's commission on jobs the customer pays you directly. It is not your earnings.</dd></div>
            <div><dt className="inline font-semibold">Reserved for active jobs: </dt><dd className="inline text-muted-foreground">the commission reserved while a job is active. It is charged when the job is completed{promoCredit.enabled ? " (promotional credit is spent first)" : ""}, and released on a valid cancellation.</dd></div>
            <div><dt className="inline font-semibold">Available: </dt><dd className="inline text-muted-foreground">total minus held. This is what covers commission on new jobs.</dd></div>
          </dl>
          <div className="rounded-2xl bg-card border p-4 space-y-3">
            <SummaryRow
              label="Credits received"
              value={money(credits)}
              tone="text-success"
              hint="Top-ups, promotional credit and returned commission (last 50 entries)"
            />
            <div className="h-px bg-border" />
            <SummaryRow
              label="Commission charged (7%)"
              value={money(commissions)}
              tone="text-destructive"
            />
            {withdrawn > 0 && (
              <>
                <div className="h-px bg-border" />
                <SummaryRow
                  label="Withdrawals (old system)"
                  value={money(withdrawn)}
                  hint="From before commission credit became non-withdrawable; kept for your records"
                />
              </>
            )}
            <div className="h-px bg-border" />
            <SummaryRow label="Jobs with commission charged" value={String(jobsCompleted)} />
          </div>

          {noFunds && (
            <Notice tone="danger" title="No available funds">
              Your available balance is {money(available)}. Top up to cover the commission on new
              jobs.
            </Notice>
          )}

        </div>
      )}

      {tab === "requests" && (
        <div className="mt-4 space-y-3">
          {(topups ?? []).length === 0 &&
          (withdrawals ?? []).length === 0 &&
          (paynowTopups ?? []).length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No requests yet"
              hint="Your top-ups will appear here."
            />
          ) : (
            <>
              {(paynowTopups ?? []).map((p) => (
                <div key={p.id} className="rounded-2xl bg-card border p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-success/15 text-success">
                    <ArrowDownLeft className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">Top-up · Paynow</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(p.paid_at ?? p.created_at).toLocaleString()} ·{" "}
                      {PAYNOW_STATUS[p.status] ?? p.status}
                    </div>
                    {p.paynow_reference && (
                      <div className="text-xs text-muted-foreground">Paynow reference {p.paynow_reference}</div>
                    )}
                    {p.status === "initiated" && (
                      <div className="text-xs text-muted-foreground">{TOPUP_AVAILABILITY}</div>
                    )}
                    {(p.status === "paid" || p.status === "released") && (
                      <button
                        type="button"
                        className="mt-1 text-xs font-semibold underline"
                        onClick={() =>
                          setReceipt({
                            paymentId: p.id,
                            amount: Number(p.amount),
                            currency: p.currency ?? "USD",
                            paidAt: p.paid_at ?? p.created_at,
                            provider: "Paynow",
                            providerReference: p.paynow_reference ?? null,
                          })
                        }
                      >
                        Receipt
                      </button>
                    )}
                  </div>
                  <div
                    className={cn(
                      "text-sm font-display font-bold",
                      p.status === "paid" || p.status === "released"
                        ? "text-success"
                        : "text-muted-foreground",
                    )}
                  >
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
                      const { error } = await (supabase as any).rpc("cancel_withdrawal", {
                        _id: r.id,
                      });
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
            <EmptyState
              icon={WalletIcon}
              title="No transactions yet"
              hint="Your top-ups and commissions will appear here."
            />
          ) : (
            <div className="space-y-2">
              {txs.map((t) => {
                const positive = Number(t.amount) >= 0;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-2xl bg-card border p-3"
                  >
                    <div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                        positive
                          ? "bg-success/15 text-success"
                          : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {positive ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{walletTxLabel(t.type)}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t.note ?? new Date(t.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "font-display font-bold text-sm",
                        positive ? "text-success" : "text-destructive",
                      )}
                    >
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

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} initialAmount={topupFromLink} />
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Top-up receipt</DialogTitle>
            <DialogDescription>Prepaid commission credit. Keep this for your records.</DialogDescription>
          </DialogHeader>
          {receipt && (
            <dl className="space-y-1.5 text-sm" data-testid="topup-receipt">
              {topupReceiptLines(receipt).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <Button variant="secondary" onClick={() => window.print()}>
            Print or save
          </Button>
        </DialogContent>
      </Dialog>
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
      : (WITHDRAWAL_STATUS[status] ?? { label: status });
  const statusTone: Record<string, string> = {
    pending: "bg-warning/15 text-warning border-warning/30",
    approved:
      isTopup || paid
        ? "bg-success/15 text-success border-success/30"
        : "bg-primary/15 text-cz-amber-text border-primary/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground border-border",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <div className="rounded-2xl bg-card border p-3">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
            isTopup ? "bg-success/15 text-success" : "bg-primary/15 text-cz-amber-text",
          )}
        >
          {isTopup ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              {isTopup ? "Top-up" : "Withdrawal"} · {method.toUpperCase()}
            </div>
            <div
              className={cn(
                "text-sm font-display font-bold",
                isTopup ? "text-success" : "text-cz-amber-text",
              )}
            >
              {isTopup ? "+" : "−"}
              {money(amount)}
            </div>
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {reference ? `Ref: ${reference} · ` : ""}
            {new Date(createdAt).toLocaleString()}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
                statusTone[status],
              )}
            >
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
        <circle
          cx="32"
          cy="32"
          r="28"
          className={cn(ring, "transition-all")}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Fuel className="w-6 h-6 text-cz-amber-text" />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
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

function TopUpDialog({
  open,
  onOpenChange,
  initialAmount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialAmount?: number;
}) {
  const [amount, setAmount] = useState<number>(initialAmount ?? 50);
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
        return toast.error(
          friendlyPaymentError(res.error, "Could not start payment. Please try again."),
        );
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
          <DialogTitle className="font-display">Add commission credit</DialogTitle>
          <DialogDescription>
            Enter an amount — you'll be securely redirected to Paynow to complete payment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl bg-muted p-4">
            <label htmlFor="topup-amount" className="text-xs text-muted-foreground">
              Enter Amount
            </label>
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
                    "flex-1 h-11 rounded-lg text-sm font-semibold tabular-nums border transition",
                    amount === p
                      ? "border-foreground bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--cz-text)]"
                      : "border-input hover:bg-muted",
                  )}
                >
                  ${p}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-cz-amber-text flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-[12px] text-muted-foreground leading-snug">
              Pay via{" "}
              <span className="font-semibold text-foreground">
                EcoCash, OneMoney, ZIPIT, bank transfer, Visa or Mastercard
              </span>{" "}
              on Paynow's secure checkout.
            </div>
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full h-12 rounded-xl">
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>Pay with Paynow — {money(amount || 0)}</>
            )}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Your wallet is credited automatically once payment is confirmed.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
