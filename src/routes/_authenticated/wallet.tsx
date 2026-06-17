import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Wallet as WalletIcon, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { money } from "@/lib/domain";
import { StatusBadge, EmptyState } from "@/components/ui-bits";

export const Route = createFileRoute("/_authenticated/wallet")({
  component: WalletPage,
});

function WalletPage() {
  const { userId, is } = useAuth();
  const { data: wallet } = useQuery({
    queryKey: ["wallet", userId],
    enabled: !!userId,
    queryFn: async () => (await supabase.from("wallets").select("*").eq("user_id", userId!).maybeSingle()).data,
  });
  const { data: txs } = useQuery({
    queryKey: ["wallet-tx", userId],
    enabled: !!userId,
    queryFn: async () => (await supabase.from("wallet_transactions").select("*").eq("user_id", userId!).order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  if (!is("driver")) return <AppShell title="Wallet"><EmptyState icon={WalletIcon} title="Wallet is for drivers" hint="Switch to a driver account from your profile." /></AppShell>;

  return (
    <AppShell title="Wallet">
      <div className="rounded-2xl bg-gradient-dark text-white p-6 shadow-lift">
        <div className="text-xs uppercase tracking-widest text-white/60">Balance</div>
        <div className="font-display font-bold text-4xl text-primary mt-1">{money(Number(wallet?.balance ?? 0))}</div>
        {wallet?.limited && <StatusBadge label="Limited — top up to bid" className="bg-destructive/20 text-destructive border-destructive/40 mt-3" />}
        <p className="text-xs text-white/70 mt-4">Top up via EcoCash, OneMoney, ZIPIT or bank transfer. Send proof to admin and they'll credit your wallet within minutes.</p>
      </div>

      <h2 className="font-display font-bold uppercase tracking-wide mt-6 mb-3">Recent activity</h2>
      {!txs?.length ? (
        <EmptyState icon={WalletIcon} title="No transactions yet" hint="Your top-ups and commissions will appear here." />
      ) : (
        <div className="space-y-2">
          {txs.map((t) => {
            const positive = Number(t.amount) >= 0;
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-xl bg-card border p-3">
                {positive ? <ArrowDownCircle className="w-6 h-6 text-success" /> : <ArrowUpCircle className="w-6 h-6 text-destructive" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold capitalize">{t.type.replace("_", " ")}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.note ?? new Date(t.created_at).toLocaleString()}</div>
                </div>
                <div className={`font-display font-bold ${positive ? "text-success" : "text-destructive"}`}>{positive ? "+" : ""}{money(Number(t.amount))}</div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
