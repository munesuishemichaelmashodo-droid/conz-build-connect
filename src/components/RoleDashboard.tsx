import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, Plus, ShieldCheck } from "lucide-react";
import { LocalLocator } from "@/components/LocalLocator";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { OnboardingWalkthrough } from "@/components/OnboardingWalkthrough";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";
import { DriverHome } from "@/components/redesign/DriverHome";
import { CzScreen, StatusPill, czButtonClass } from "@/components/redesign";
import { JobRow } from "@/components/redesign/JobRow";
import { CustomerBottomNav, NAV_SPACE } from "@/components/redesign/DriverBottomNav";
import { LogoLockup } from "@/components/ds";
import { TipperIllustration } from "@/components/ds/media";
import { customerTrustPill, useLaunchSwitches } from "@/lib/launch-switches";

export function RoleDashboard({ role }: { role: "driver" | "customer" }) {
  const { userId, profile, is } = useAuth();
  const launch = useLaunchSwitches();
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

  const restrictedUntil = (profile as any)?.restricted_until as string | null | undefined;
  const restricted = isCustomer && !!restrictedUntil ? new Date(restrictedUntil) > new Date() : false;
  const showVerificationWarning = isDriver && driver?.verification_status !== "verified";

  // Driver mode redesign (D1): same three queries above, new presentation.
  if (isDriver) {
    return (
      <DriverHome
        userId={userId}
        firstName={profile?.full_name?.split(" ")[0] ?? null}
        jobs={jobs as any}
        wallet={wallet as any}
        driver={driver as any}
        showVerificationWarning={showVerificationWarning}
      />
    );
  }

  // Customer mode redesign: same queries/flags as before, new look. The
  // booking itself (C1) lives at /customer/book.
  const first = profile?.full_name?.split(" ")[0] ?? "Builder";
  return (
    <>
    <CzScreen className={NAV_SPACE}>
      {userId && <OnboardingWalkthrough userId={userId} role={role} />}
      <header className="flex items-center justify-between gap-2 px-5 pt-3 pb-3">
        <div className="min-w-0">
          <LogoLockup to="/customer" />
          <div className="text-[13px] text-cz-muted truncate">Hi {first}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <NotificationsBell />
          <SidePanel />
        </div>
      </header>

      <div className="px-5 space-y-4">
        <div id="tour-dashboard-hero" data-tour="dashboard-hero" className="relative overflow-hidden rounded-2xl border border-cz-border bg-cz-surface">
          <img
            src="/hero-tipper-720.webp"
            alt=""
            width={720}
            height={437}
            className="h-[132px] w-full bg-cz-surface-2 object-cover object-[50%_45%]"
          />
          <div className="relative space-y-3 p-5">
            <StatusPill tone="green" icon={<ShieldCheck className="w-3.5 h-3.5" />} className="px-2.5 py-1 text-xs">
              {customerTrustPill(launch.escrowEnabled)}
            </StatusPill>
            <h1 className="cz-display font-bold text-[30px] leading-[1.05]">What do you need delivered today?</h1>
            <p className="text-sm text-cz-muted">River sand, stones, gravel and more. See a price in seconds, then pick a checked driver.</p>
            {!restricted && (
              <Link id="tour-book-delivery-cta" data-tour="book-delivery-cta" to="/customer/book" className={czButtonClass("primary")}>
                <Plus className="w-5 h-5" /> Book a delivery
              </Link>
            )}
            {!restricted && (
              <p className="text-xs leading-snug text-cz-faint">
                Cancelling after a driver accepts may affect your account. See the cancellation policy.
              </p>
            )}
          </div>
        </div>

        {restricted && (
          <div className="rounded-xl bg-cz-warn-tint p-3.5 text-sm text-cz-warn-text">
            <div className="font-semibold">Posting temporarily restricted</div>
            <div className="text-xs mt-1 opacity-90">
              Your account is temporarily restricted from posting new jobs until{" "}
              {new Date(restrictedUntil!).toLocaleString()} due to cancellation history.
            </div>
          </div>
        )}

        <PushNotificationPrompt />

        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="cz-display font-bold text-[22px]">Recent jobs</h2>
            <Link id="tour-jobs-link" to="/jobs" className="min-h-11 inline-flex items-center gap-1 rounded-lg px-2 -mr-2 text-sm font-semibold text-cz-text underline underline-offset-4 hover:bg-cz-surface-2">
              My jobs <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {(jobs ?? []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-cz-border-strong p-8 text-center">
              <TipperIllustration className="mx-auto w-40 opacity-90" />
              <p className="mt-3 font-semibold">Nothing here yet</p>
              <p className="text-sm text-cz-muted">Post your first job to get bids.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {jobs!.map((j) => (
                <JobRow key={j.id} j={j} />
              ))}
            </div>
          )}
        </section>

        <LocalLocator />
      </div>
    </CzScreen>
    <CustomerBottomNav />
    </>
  );
}
