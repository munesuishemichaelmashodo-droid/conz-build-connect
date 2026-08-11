import { DriverNavigationButtons } from "./DriverNavigationButtons";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Section, EmptyState, StatusBadge } from "@/components/ui-bits";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Briefcase, Plus, Truck, Wallet as WalletIcon, ShieldAlert, Star } from "lucide-react";
import { money, levelInfo } from "@/lib/domain";
import { JobCard } from "@/routes/_authenticated/home";
import { LocalLocator } from "@/components/LocalLocator";
import { JobOfferListener } from "@/components/JobOfferListener";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { OnboardingWalkthrough } from "@/components/OnboardingWalkthrough";




export function RoleDashboard({ role }: { role: "driver" | "customer" }) {
  const { userId, profile, is } = useAuth();
  const isDriver = role === "driver";
  const isCustomer = role === "customer";
  void is;

  
  


  const { data: jobs } = useQuery({
    queryKey: ["role-dash-jobs", userId, role],
    enabled: !!userId,
    refetchInterval: 4000,
    queryFn: async () => {
      const q = supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(5);
      if (isDriver) q.eq("status", "open");
      else q.eq("customer_id", userId!);
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

  return (
    <AppShell title={isDriver ? "Driver" : "Customer"}>
      {userId && <OnboardingWalkthrough userId={userId} role={role} />}
      <div className="space-y-6">
        {isDriver && <JobOfferListener />}
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

        {isDriver && driver && (
          <div className="rounded-2xl border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-display font-bold uppercase text-sm tracking-wide">
                {levelInfo(driver.level).label} perks
              </div>
              <StatusBadge label={levelInfo(driver.level).label} className={levelInfo(driver.level).className} />
            </div>
            {levelInfo(driver.level).discountPct > 0 ? (
              <p className="text-sm text-muted-foreground">
                You get <span className="font-semibold text-foreground">{levelInfo(driver.level).discountPct}% off commission</span> on
                every completed job.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Higher levels get a bigger commission discount — complete{" "}
                {levelInfo(driver.level).nextAt} jobs to reach Silver.
              </p>
            )}
            {levelInfo(driver.level).nextAt != null && (
              <p className="text-xs text-muted-foreground">
                {Math.max(0, levelInfo(driver.level).nextAt! - driver.jobs_completed)} more completed job
                {levelInfo(driver.level).nextAt! - driver.jobs_completed === 1 ? "" : "s"} to level up.
              </p>
            )}
          </div>
        )}

        <LocalLocator />

        <PushNotificationPrompt />

        {isCustomer && (() => {
          const restrictedUntil = (profile as any)?.restricted_until as string | null | undefined;
          const restricted = restrictedUntil ? new Date(restrictedUntil) > new Date() : false;
          return (
            <div className="space-y-2">
              {restricted && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <div className="font-semibold text-destructive">Posting temporarily restricted</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    Your account is temporarily restricted from posting new jobs until{" "}
                    {new Date(restrictedUntil!).toLocaleString()} due to cancellation history.
                  </div>
                </div>
              )}
              {!restricted && (
                <Link to="/customer/book" className="block rounded-xl bg-gradient-primary text-primary-foreground p-4 shadow-lift">
                  <Plus className="w-6 h-6" />
                  <div className="font-display font-bold mt-2 uppercase">Book delivery</div>
                  <div className="text-xs opacity-80">AI-priced in seconds</div>
                </Link>
              )}
              <p className="text-[11px] text-muted-foreground px-1">
                Cancelling jobs after a driver accepts may affect your account — see our cancellation policy.
              </p>
            </div>
          );
        })()}

        <div className="grid grid-cols-2 gap-3">
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

<Section
  title={isDriver ? "Open jobs" : "Recent jobs"}
  action={
    <Link to="/jobs" className="text-xs font-semibold text-primary uppercase tracking-wide">
      See all
    </Link>
  }
>
  {(jobs ?? []).length === 0 ? (
    <EmptyState
      icon={Truck}
      title="Nothing here yet"
      hint={isCustomer ? "Post your first job to get bids." : "No open jobs in your area right now."}
    />
  ) : (
    <div className="space-y-3">
      {jobs!.map((j) => {
        const job = j as any;

        return (
          <div key={job.id} className="space-y-2">
            <JobCard j={j} />

            {isDriver && (
              <DriverNavigationButtons
                pickup={{
                  lat: job.pickup_lat ?? -17.8292,
                  lng: job.pickup_lng ?? 31.0522,
                }}
                dropoff={{
                  lat: job.delivery_lat,
                  lng: job.delivery_lng,
                }}
                pickupLabel={job.pickup_address ?? "Harare CBD supplier pickup point"}
                dropoffLabel={job.delivery_address ?? "Drop-off"}
              />
            )}
          </div>
        );
      })}
    </div>
  )}
</Section>
      </div>
    </AppShell>
  );
}
