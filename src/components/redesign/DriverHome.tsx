import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ShieldAlert, Star, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { levelInfo } from "@/lib/domain";
import { bestCapacityMatchTier } from "@/lib/capacityMatch";
import { JobOfferListener } from "@/components/JobOfferListener";
import { PushNotificationPrompt } from "@/components/PushNotificationPrompt";
import { OnboardingWalkthrough } from "@/components/OnboardingWalkthrough";
import { DriverAvailabilityToggle } from "@/components/DriverAvailabilityToggle";
import { LocalLocator } from "@/components/LocalLocator";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";
import { CzScreen, MaterialChips, usd2 } from "@/components/redesign";
import { FeedJobCard, type FeedJob } from "@/components/redesign/FeedJobCard";
import { DriverBottomNav, DRIVER_NAV_SPACE } from "@/components/redesign/DriverBottomNav";
import { useQuickAccept } from "@/components/redesign/useQuickAccept";

/** Client-side material filter for the feed. Keys are display groups; the
 *  values are the job.material enum values each one covers. */
export const FEED_FILTERS: { value: string; label: string; materials: string[] | null }[] = [
  { value: "all", label: "All", materials: null },
  { value: "sand", label: "Sand", materials: ["river_sand", "pit_sand"] },
  { value: "gravel", label: "Gravel", materials: ["gravel"] },
  { value: "stones", label: "Stones", materials: ["stones"] },
  { value: "aggregates", label: "Dust & crusher run", materials: ["quarry_dust", "crusher_run"] },
  { value: "soil", label: "Soil", materials: ["top_soil", "filling_soil"] },
  { value: "other", label: "Other", materials: ["custom"] },
];

export function filterJobs<T extends { material: string }>(jobs: T[], filter: string) {
  const f = FEED_FILTERS.find((x) => x.value === filter);
  if (!f?.materials) return jobs;
  return jobs.filter((j) => f.materials!.includes(j.material));
}

/**
 * D1 · Driver home / job feed. Receives the exact data RoleDashboard
 * already fetches (open jobs, wallet, driver profile) — no new data flow,
 * apart from reading the driver's own trucks with the same query + cache
 * key the bid form uses, to show the registration and capacity fit.
 */
export function DriverHome({
  userId,
  firstName,
  jobs,
  wallet,
  driver,
  showVerificationWarning,
}: {
  userId: string | null;
  firstName: string | null;
  jobs: FeedJob[] | undefined;
  wallet: { balance: number; limited?: boolean | null } | null | undefined;
  driver: { level: string; rating_avg: number; jobs_completed: number } | null | undefined;
  showVerificationWarning: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const { accept, busyJobId } = useQuickAccept();

  const { data: trucks } = useQuery({
    queryKey: ["my-trucks", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trucks")
        .select("id,registration,capacity_m3")
        .eq("driver_id", userId!)
        .order("capacity_m3");
      if (error) throw error;
      return data;
    },
  });

  const capacities = (trucks ?? []).map((t) => Number(t.capacity_m3));
  const shown = useMemo(() => filterJobs(jobs ?? [], filter), [jobs, filter]);
  const level = driver ? levelInfo(driver.level) : null;

  return (
    <>
      <CzScreen className={DRIVER_NAV_SPACE}>
        {userId && <OnboardingWalkthrough userId={userId} role="driver" />}
        <JobOfferListener />

        <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <div className="cz-display font-bold text-[26px] leading-tight">
              Con Z <span className="text-cz-amber">Driver</span>
            </div>
            <div className="text-[13px] text-cz-muted truncate">
              {firstName ? `Hi ${firstName}` : "Welcome back"}
              {trucks?.length ? ` · Truck ${trucks[0].registration}${trucks.length > 1 ? ` +${trucks.length - 1}` : ""}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <DriverAvailabilityToggle variant="pill" />
            <NotificationsBell />
            <SidePanel />
          </div>
        </header>

        <div className="px-5 space-y-3">
          <div
            id="tour-dashboard-hero"
            className="rounded-[14px] border border-cz-border bg-cz-surface px-4 py-3 flex items-center justify-between gap-3"
          >
            <Link to="/wallet" className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[13px] text-cz-muted">Wallet</span>
              <span className="cz-display font-bold text-2xl tabular-nums">{wallet ? usd2(Number(wallet.balance)) : "—"}</span>
              {wallet?.limited && <span className="text-xs font-semibold text-cz-danger-text">Limited — top up to bid</span>}
            </Link>
            {driver && level && (
              <div className="flex flex-col items-end gap-0.5 text-right">
                <span className="text-[13px] text-cz-muted flex items-center gap-1">
                  <Star className="w-3.5 h-3.5 fill-cz-amber text-cz-amber" />
                  {Number(driver.rating_avg).toFixed(1)} · {driver.jobs_completed} jobs done
                </span>
                <span className="text-[13px] font-semibold text-cz-amber">{level.label} level</span>
                {level.nextAt != null && (
                  <span className="text-[11px] text-cz-faint">
                    {Math.max(0, level.nextAt - driver.jobs_completed)} to next level
                    {level.discountPct > 0 ? ` · ${level.discountPct}% off fees` : ""}
                  </span>
                )}
                {level.nextAt == null && level.discountPct > 0 && (
                  <span className="text-[11px] text-cz-faint">{level.discountPct}% off Con Z fees</span>
                )}
              </div>
            )}
          </div>

          <PushNotificationPrompt />

          {showVerificationWarning && (
            <Link
              id="tour-driver-verification"
              to="/profile"
              className="flex items-center gap-3 rounded-[14px] bg-cz-warn-tint p-3.5 text-cz-warn-text"
            >
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <div className="text-sm min-w-0 flex-1">
                <div className="font-semibold">Complete your verification</div>
                <div className="text-xs opacity-90">Upload your ID, truck, and selfie to start bidding.</div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </Link>
          )}
        </div>

        <div className="flex items-center justify-between px-5 pt-5 pb-2.5">
          <h2 className="cz-display font-bold text-[22px]">
            {shown.length} {shown.length === 1 ? "load" : "loads"} near you
          </h2>
          <span className="text-[13px] text-cz-muted flex items-center gap-1.5">
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-cz-green cz-blink" /> Updated live
          </span>
        </div>
        <div className="px-5 pb-3.5">
          <MaterialChips options={FEED_FILTERS} value={filter} onChange={setFilter} size="sm" />
        </div>

        <div className="px-5 flex flex-col gap-3">
          {shown.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-cz-border-strong p-8 text-center">
              <Truck className="w-9 h-9 mx-auto text-cz-faint" />
              <p className="mt-2 font-semibold">No open loads right now</p>
              <p className="text-sm text-cz-muted">
                {filter === "all" ? "Stay online — we'll notify you when a new job is posted." : "Try another material filter."}
              </p>
            </div>
          ) : (
            shown.map((j, i) => (
              <FeedJobCard
                key={j.id}
                job={j}
                highlight={i === 0}
                matchTier={capacities.length ? bestCapacityMatchTier(Number(j.quantity_m3), capacities) : undefined}
                onAccept={() => accept(j)}
                accepting={busyJobId === j.id}
              />
            ))
          )}

          <Link
            to="/jobs"
            className="flex items-center justify-center gap-1 min-h-12 rounded-xl text-[15px] font-semibold text-cz-amber"
          >
            See all loads & my jobs <ChevronRight className="w-4 h-4" />
          </Link>

          <div className="pt-2">
            <LocalLocator />
          </div>
        </div>
      </CzScreen>
      <DriverBottomNav />
    </>
  );
}
