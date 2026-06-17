import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Section, EmptyState, StatusBadge } from "@/components/ui-bits";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Briefcase, Plus, Truck, Wallet as WalletIcon, ShieldAlert, Star } from "lucide-react";
import { materialLabel, money, statusInfo, levelInfo } from "@/lib/domain";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function HomePage() {
  const { userId, profile, is, loading } = useAuth();
  const isDriver = is("driver");
  const isCustomer = is("customer");

  const { data: jobs } = useQuery({
    queryKey: ["home-jobs", userId, isDriver, isCustomer],
    enabled: !!userId,
    queryFn: async () => {
      const q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(5);
      if (isDriver) q.eq("status", "open");
      else if (isCustomer) q.eq("customer_id", userId!);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: wallet } = useQuery({
    queryKey: ["wallet", userId],
    enabled: !!userId && isDriver,
    queryFn: async () => {
      const { data } = await supabase.from("wallets").select("*").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  const { data: driver } = useQuery({
    queryKey: ["driver-profile", userId],
    enabled: !!userId && isDriver,
    queryFn: async () => {
      const { data } = await supabase.from("driver_profiles").select("*").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  if (loading) return <AppShell><div className="text-center text-muted-foreground py-10">Loading…</div></AppShell>;

  return (
    <AppShell title={isDriver ? "Driver" : isCustomer ? "Customer" : "Con Z"}>
      <div className="space-y-6">
        <div className="rounded-2xl bg-gradient-dark text-white p-5 shadow-lift">
          <div className="text-xs uppercase tracking-widest text-white/60">Welcome back</div>
          <div className="font-display font-bold text-2xl mt-1">{profile?.full_name?.split(" ")[0] ?? "Builder"}</div>
          {isDriver && wallet && (
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-white/60">Wallet</div>
                <div className="font-display font-bold text-3xl text-primary">{money(Number(wallet.balance))}</div>
                {wallet.limited && <StatusBadge label="Limited" className="bg-destructive/20 text-destructive border-destructive/40 mt-1" />}
              </div>
              {driver && (
                <div className="text-right">
                  <StatusBadge label={levelInfo(driver.level).label} className={levelInfo(driver.level).className} />
                  <div className="text-xs text-white/70 mt-1 flex items-center gap-1 justify-end">
                    <Star className="w-3 h-3 fill-current text-warning" />
                    {Number(driver.rating_avg).toFixed(1)} • {driver.jobs_completed} jobs
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {isDriver && driver?.verification_status !== "verified" && (
          <Link to="/profile" className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
            <ShieldAlert className="w-5 h-5 text-warning shrink-0" />
            <div className="text-sm">
              <div className="font-semibold">Complete your verification</div>
              <div className="text-muted-foreground text-xs">Upload your ID, truck, and selfie to start bidding.</div>
            </div>
          </Link>
        )}

        <div className="grid grid-cols-2 gap-3">
          {isCustomer && (
            <Link to="/jobs/new" className="rounded-xl bg-gradient-primary text-primary-foreground p-4 shadow-lift">
              <Plus className="w-6 h-6" />
              <div className="font-display font-bold mt-2 uppercase">Post a job</div>
              <div className="text-xs opacity-80">Get bids in minutes</div>
            </Link>
          )}
          <Link to="/jobs" className="rounded-xl bg-card border p-4 shadow-soft">
            <Briefcase className="w-6 h-6 text-primary" />
            <div className="font-display font-bold mt-2 uppercase">{isDriver ? "Find jobs" : "My jobs"}</div>
            <div className="text-xs text-muted-foreground">{isDriver ? "Open requests" : "Track progress"}</div>
          </Link>
          {isDriver && (
            <Link to="/wallet" className="rounded-xl bg-card border p-4 shadow-soft">
              <WalletIcon className="w-6 h-6 text-primary" />
              <div className="font-display font-bold mt-2 uppercase">Wallet</div>
              <div className="text-xs text-muted-foreground">Top-ups & fees</div>
            </Link>
          )}
        </div>

        <Section title={isDriver ? "Open jobs" : "Recent jobs"} action={
          <Link to="/jobs" className="text-xs font-semibold text-primary uppercase tracking-wide">See all</Link>
        }>
          {(jobs ?? []).length === 0 ? (
            <EmptyState icon={Truck} title="Nothing here yet" hint={isCustomer ? "Post your first job to get bids." : "No open jobs in your area right now."} />
          ) : (
            <div className="space-y-2">
              {jobs!.map((j) => <JobCard key={j.id} j={j} />)}
            </div>
          )}
        </Section>

        {!isDriver && !isCustomer && (
          <Button asChild className="w-full"><Link to="/profile">Set up your account</Link></Button>
        )}
      </div>
    </AppShell>
  );
}

export function JobCard({ j }: { j: { id: string; material: string; custom_material: string | null; quantity_m3: number; delivery_address: string; budget: number; status: string } }) {
  const s = statusInfo(j.status);
  return (
    <Link to="/jobs/$id" params={{ id: j.id }} className="block rounded-xl bg-card border p-4 shadow-soft hover:border-primary transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-bold text-base truncate">{materialLabel(j.material as never, j.custom_material)}</div>
          <div className="text-xs text-muted-foreground truncate">{j.delivery_address}</div>
        </div>
        <StatusBadge label={s.label} className={s.className} />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{Number(j.quantity_m3)} m³</span>
        <span className="font-display font-bold text-primary text-lg">{money(Number(j.budget))}</span>
      </div>
    </Link>
  );
}
