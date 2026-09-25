import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ChevronRight, Plus, ShieldCheck, Truck } from "lucide-react";
import { LocalLocator } from "@/components/LocalLocator";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { OnboardingWalkthrough } from "@/components/OnboardingWalkthrough";
import { RouteLine } from "@/components/RouteLine";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";
import { DriverHome } from "@/components/redesign/DriverHome";
import { BrandMark, CzScreen } from "@/components/redesign";
import { JobRow } from "@/components/redesign/JobRow";

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
      const q = supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
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
      const { data } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  const { data: driver } = useQuery({
    queryKey: ["driver-profile", userId],
    enabled: !!userId && isDriver,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_profiles")
        .select("*")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  const restrictedUntil = (profile as any)?.restricted_until as string | null | undefined;
  const restricted =
    isCustomer && !!restrictedUntil ? new Date(restrictedUntil) > new Date() : false;
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
    <CzScreen className="pb-8">
      {userId && <OnboardingWalkthrough userId={userId} role={role} />}
      <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark size={34} />
          <div className="min-w-0">
            <div className="cz-display font-bold text-[26px] leading-tight">
              Con Z <span className="text-cz-amber">Connect</span>
            </div>
            <div className="text-[13px] text-cz-muted truncate">Hi {first}</div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <NotificationsBell />
          <SidePanel />
        </div>
      </header>

      <div className="px-5 space-y-4">
        <div
          id="tour-dashboard-hero"
          className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#ff9a3d_0%,#fb7201_45%,#e85600_100%)] p-5 text-cz-amber-ink shadow-[0_18px_40px_-18px_rgba(251,114,1,0.75)]"
        >
          {/* Route line drawn in black on the orange card. */}
          <div style={{ ["--color-primary" as string]: "#0b0b0c" }}>
            <RouteLine opacity={0.18} animate />
          </div>
          <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cz-amber-ink/85 px-2.5 py-1 text-xs font-semibold text-[#ffb070]">
              <ShieldCheck className="w-3.5 h-3.5" /> Escrow protected with Con Z Pay
            </span>
            <h1 className="cz-display font-bold text-[32px] leading-[1.02]">
              What do you need delivered today?
            </h1>
            <p className="text-sm font-medium text-cz-amber-ink/75">
              River sand, stones, gravel and more — priced in seconds, delivered by verified tipper
              trucks.
            </p>
            {!restricted && (
              <Link
                id="tour-book-delivery-cta"
                to="/customer/book"
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-cz-amber-ink px-5 text-base font-bold text-white shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)] transition-transform duration-150 active:scale-[0.97]"
              >
                <Plus className="w-5 h-5 text-cz-amber" /> Book a delivery
              </Link>
            )}
          </div>
        </div>

        {restricted && (
          <div className="rounded-[14px] bg-cz-warn-tint p-3.5 text-sm text-cz-warn-text">
            <div className="font-semibold">Posting temporarily restricted</div>
            <div className="text-xs mt-1 opacity-90">
              Your account is temporarily restricted from posting new jobs until{" "}
              {new Date(restrictedUntil!).toLocaleString()} due to cancellation history.
            </div>
          </div>
        )}
        {!restricted && (
          <p className="text-[11px] text-cz-faint px-1">
            Cancelling jobs after a driver accepts may affect your account — see our cancellation
            policy.
          </p>
        )}

        <PushNotificationPrompt />

        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="cz-display font-bold text-[22px]">Recent jobs</h2>
            <Link
              id="tour-jobs-link"
              to="/jobs"
              className="min-h-11 inline-flex items-center gap-1 text-sm font-semibold text-cz-amber"
            >
              My jobs <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {(jobs ?? []).length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-cz-border-strong p-8 text-center">
              <Truck className="w-9 h-9 mx-auto text-cz-faint" />
              <p className="mt-2 font-semibold">Nothing here yet</p>
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
  );
}
