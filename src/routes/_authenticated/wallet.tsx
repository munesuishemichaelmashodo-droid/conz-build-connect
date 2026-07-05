import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Wallet as WalletIcon,
  Fuel,
  Plus,
  History,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Smartphone,
  CreditCard,
} from "lucide-react";
import { money } from "@/lib/domain";
import { EmptyState } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export const Route = createFileRoute("/_authenticated/wallet")({
  component: WalletPage,
});

const MIN_BALANCE = 10;

function WalletPage() {
  const { userId, is } = useAuth();
  const [tab, setTab] = useState<"summary" | "history">("summary");
  const [topUpOpen, setTopUpOpen] = useState(false);

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

  if (!is("driver"))
    return (
      <AppShell title="Wallet">
        <EmptyState icon={WalletIcon} title="Wallet is for drivers" hint="Switch to a driver account from your profile." />
      </AppShell>
    );

  const balance = Number(wallet?.balance ?? 0);
  const healthy = balance >= MIN_BALANCE * 3;
  const low = balance >= MIN_BALANCE && !healthy;
  const veryLow = balance < MIN_BALANCE;

  const status = veryLow
    ? { label: "Very Low", tone: "text-destructive", dot: "bg-destructive", ring: "stroke-destructive" }
    : low
    ? { label: "Low Balance", tone: "text-warning", dot: "bg-warning", ring: "stroke-warning" }
    : { label: "Healthy Balance", tone: "text-success", dot: "bg-success", ring: "stroke-success" };

  const deposits = (txs ?? []).filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const commissions = (txs ?? []).filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);
  const jobsCompleted = (txs ?? []).filter((t) => String(t.type).includes("commission")).length;

  return (
    <AppShell title="Driver Wallet">
      {/* Hero balance card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-dark text-white p-6 shadow-lift"
      >
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="flex items-start justify-between relative">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">Available Balance</div>
            <div className="font-display font-bold text-primary text-5xl mt-1 tracking-tight">{money(balance)}</div>
            <div className={cn("inline-flex items-center gap-1.5 mt-3 text-xs font-semibold", status.tone)}>
              <span className={cn("w-2 h-2 rounded-full", status.dot)} />
              {status.label}
            </div>
          </div>
          <Gauge balance={balance} ring={status.ring} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 relative">
          <Button
            onClick={() => setTopUpOpen(true)}
            className="h-11 rounded-xl font-display uppercase tracking-wide"
          >
            <Plus className="w-4 h-4 mr-1" /> Top Up
          </Button>
          <Button
            onClick={() => setTab("history")}
            variant="secondary"
            className="h-11 rounded-xl font-display uppercase tracking-wide bg-white/10 text-white hover:bg-white/20 border-white/10"
          >
            <History className="w-4 h-4 mr-1" /> History
          </Button>
        </div>

        <p className="text-[11px] text-white/60 mt-4 relative">
          The 7% commission hold is deducted from this wallet after every completed job.
        </p>
      </motion.div>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 rounded-xl bg-muted p-1">
        {(["summary", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 h-9 rounded-lg text-xs font-display uppercase tracking-wide transition",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t === "summary" ? "Wallet Summary" : "Recent Activity"}
          </button>
        ))}
      </div>

      {tab === "summary" ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl bg-card border p-4 space-y-3">
            <SummaryRow label="Total Deposits" value={money(deposits)} tone="text-success" />
            <div className="h-px bg-border" />
            <SummaryRow label="Total Commissions Paid (7%)" value={money(commissions)} tone="text-destructive" />
            <div className="h-px bg-border" />
            <SummaryRow label="Jobs Completed" value={String(jobsCompleted)} />
            <div className="h-px bg-border" />
            <SummaryRow
              label="Minimum Balance"
              value={money(MIN_BALANCE)}
              hint="Required to stay online"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Feature icon={Shield} title="Bank-grade security" hint="Encrypted, auditable transactions." />
            <Feature icon={Zap} title="Instant top-ups" hint="EcoCash, OneMoney, ZIPIT." />
            <Feature icon={CheckCircle2} title="Real payments only" hint="No fake receipts, verified." />
            <Feature icon={AlertTriangle} title="Low-balance alerts" hint="We warn before you go offline." />
          </div>

          {veryLow && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="font-display font-bold uppercase text-xs tracking-wide">Top up now</div>
              <p className="text-[13px] mt-1 opacity-90">
                Your balance is below {money(MIN_BALANCE)}. You won't receive new jobs until you top up.
              </p>
            </div>
          )}
        </div>
      ) : (
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
                      <div className="text-[11px] text-muted-foreground truncate">
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
    </AppShell>
  );
}

function Gauge({ balance, ring }: { balance: number; ring: string }) {
  const pct = Math.max(0.05, Math.min(1, balance / (MIN_BALANCE * 5)));
  const c = 2 * Math.PI * 28;
  return (
    <div className="relative w-20 h-20 shrink-0">
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
        {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className={cn("font-display font-bold text-sm", tone)}>{value}</div>
    </div>
  );
}

function Feature({ icon: Icon, title, hint }: { icon: typeof Shield; title: string; hint: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3">
      <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-2">
        <Icon className="w-4 h-4" />
      </div>
      <div className="text-xs font-display font-bold">{title}</div>
      <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{hint}</div>
    </div>
  );
}

function TopUpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [amount, setAmount] = useState<number>(50);
  const presets = [10, 20, 50, 100];
  const methods = [
    { id: "ecocash", label: "EcoCash", hint: "Instant", icon: Smartphone },
    { id: "onemoney", label: "OneMoney", hint: "Instant", icon: Smartphone },
    { id: "zipit", label: "ZIPIT", hint: "Instant", icon: CreditCard },
    { id: "bank", label: "Bank Transfer", hint: "1–5 min", icon: Building2 },
  ];
  const [method, setMethod] = useState("ecocash");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">Top Up Wallet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl bg-muted p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Enter Amount</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-display font-bold text-3xl">$</span>
              <input
                type="number"
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

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Choose Payment Method</div>
            <div className="space-y-1.5">
              {methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition",
                    method === m.id ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <m.icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{m.label}</div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{m.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full h-12 rounded-xl font-display uppercase tracking-wide">
            Continue — {money(amount)}
          </Button>
          <p className="text-[11px] text-center text-muted-foreground">
            After paying, send proof to admin. Wallet is credited within minutes.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
