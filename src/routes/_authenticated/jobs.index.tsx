import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Briefcase, Plus } from "lucide-react";
import { bestCapacityMatchTier, type CapacityMatchTier } from "@/lib/capacityMatch";
import { materialLabel } from "@/lib/domain";
import { ChevronRight } from "lucide-react";
import { CzScreen, CzHeader, StatusPill, usd } from "@/components/redesign";
import { FeedJobCard } from "@/components/redesign/FeedJobCard";
import { DriverBottomNav, DRIVER_NAV_SPACE } from "@/components/redesign/DriverBottomNav";
import { useQuickAccept } from "@/components/redesign/useQuickAccept";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SidePanel } from "@/components/SidePanel";

export const Route = createFileRoute("/_authenticated/jobs/")({
  component: JobsPage,
});

const TIER_RANK: Record<CapacityMatchTier, number> = { excellent: 0, good: 1, oversized: 2, multiple_trips: 3 };

function JobsPage() {
  const { userId, is } = useAuth();
  const isDriver = is("driver");
  const isCustomer = is("customer");
  const queryClient = useQueryClient();
  const { accept, busyJobId } = useQuickAccept();

  const { data: myTrucks } = useQuery({
    queryKey: ["my-trucks-capacities", userId],
    enabled: !!userId && isDriver,
    queryFn: async () => {
      const { data, error } = await supabase.from("trucks").select("capacity_m3").eq("driver_id", userId!);
      if (error) throw error;
      return (data ?? []).map((t) => Number(t.capacity_m3));
    },
  });

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["jobs-list", userId, isDriver, isCustomer],
    enabled: !!userId,
    refetchInterval: 4000,
    queryFn: async () => {
      let q = supabase.from("jobs").select("*").order("created_at", { ascending: false });
      if (isCustomer && !isDriver) q = q.eq("customer_id", userId!);
      else if (isDriver && !isCustomer)
        q = q.or(`status.eq.open,driver_id.eq.${userId}`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  // Realtime freshness ONLY — the 4s poll above remains the authoritative
  // safety net and is never removed. This subscription just tries to
  // shorten the visible delay before an already-accepted job disappears
  // from other drivers' lists: on any jobs UPDATE we can see, invalidate
  // the query so it refetches from the server (the actual source of
  // truth) rather than trying to patch the realtime payload into the
  // cache directly. If the realtime channel never fires for a given
  // change (connection drop, or an update whose row isn't visible to us
  // under RLS at that instant), the existing 4s poll still guarantees the
  // list is correct shortly after — this subscription can only ever make
  // things feel faster, never make them wrong.
  useEffect(() => {
    if (!userId || !isDriver) return;
    const ch = supabase
      .channel(`open-jobs-freshness-${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs" },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["jobs-list", userId, isDriver, isCustomer] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, isDriver, isCustomer, queryClient]);

  // Best-matched-first for open jobs a driver hasn't bid on yet; jobs the
  // driver already has (own bid/assigned) keep their normal recency order.
  // Purely a display/ordering preference — every eligible job stays visible
  // and biddable regardless of rank.
  const orderedJobs =
    isDriver && myTrucks?.length && jobs
      ? [...jobs].sort((a, b) => {
          const aOpen = a.status === "open" && a.driver_id !== userId;
          const bOpen = b.status === "open" && b.driver_id !== userId;
          if (aOpen && bOpen) {
            const ra = TIER_RANK[bestCapacityMatchTier(Number(a.quantity_m3), myTrucks) ?? "oversized"] ?? 9;
            const rb = TIER_RANK[bestCapacityMatchTier(Number(b.quantity_m3), myTrucks) ?? "oversized"] ?? 9;
            if (ra !== rb) return ra - rb;
          }
          return 0;
        })
      : jobs;

  // Driver / customer mode redesign: same query, poll and realtime channel
  // above; the list is grouped by what needs attention.
  const all = orderedJobs ?? [];
  const mineActive = all.filter((j) => (isDriver ? j.driver_id === userId : true) && (j.status === "accepted" || j.status === "in_progress"));
  const openLoads = all.filter((j) => j.status === "open" && (isDriver ? j.customer_id !== userId : true));
  const past = all.filter((j) => (isDriver ? j.driver_id === userId : true) && (j.status === "completed" || j.status === "cancelled"));

  return (
    <>
      <CzScreen className={isDriver && !isCustomer ? DRIVER_NAV_SPACE : "pb-8"}>
        <CzHeader
          title={isDriver && !isCustomer ? "My jobs" : "Jobs"}
          backTo={isDriver && !isCustomer ? "/driver" : "/customer"}
          right={
            <div className="flex items-center gap-0.5">
              {isCustomer && (
                <Link to="/jobs/new" className="min-h-11 inline-flex items-center gap-1 rounded-xl bg-cz-amber px-3 text-sm font-bold text-cz-amber-ink">
                  <Plus className="w-4 h-4" /> New
                </Link>
              )}
              <NotificationsBell />
              <SidePanel />
            </div>
          }
        />
        <div id="tour-jobs-list" className="px-5 space-y-6">
          {isLoading ? (
            <div className="text-center text-cz-muted py-10">Loading…</div>
          ) : all.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-cz-border-strong p-8 text-center">
              <Briefcase className="w-9 h-9 mx-auto text-cz-faint" />
              <p className="mt-2 font-semibold">No jobs yet</p>
              <p className="text-sm text-cz-muted">{isCustomer ? "Post your first delivery request." : "Check back soon for open requests."}</p>
            </div>
          ) : (
            <>
              {mineActive.length > 0 && (
                <JobGroup title={isDriver && !isCustomer ? "Active now" : "In progress"}>
                  {mineActive.map((j) => <JobRow key={j.id} j={j} />)}
                </JobGroup>
              )}
              {openLoads.length > 0 && (
                <JobGroup title={isDriver && !isCustomer ? `${openLoads.length} open load${openLoads.length === 1 ? "" : "s"}` : "Waiting for offers"}>
                  {isDriver && !isCustomer
                    ? openLoads.map((j) => (
                        <FeedJobCard
                          key={j.id}
                          job={j}
                          matchTier={myTrucks?.length ? bestCapacityMatchTier(Number(j.quantity_m3), myTrucks) : undefined}
                          onAccept={() => accept(j)}
                          accepting={busyJobId === j.id}
                        />
                      ))
                    : openLoads.map((j) => <JobRow key={j.id} j={j} />)}
                </JobGroup>
              )}
              {past.length > 0 && (
                <JobGroup title="Completed & cancelled">
                  {past.map((j) => <JobRow key={j.id} j={j} />)}
                </JobGroup>
              )}
            </>
          )}
        </div>
      </CzScreen>
      {isDriver && !isCustomer && <DriverBottomNav />}
    </>
  );
}

function JobGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="cz-display font-bold text-xl">{title}</h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

const ROW_STATUS: Record<string, { label: string; tone: "green" | "amber" | "neutral" | "info" }> = {
  open: { label: "Open", tone: "amber" },
  accepted: { label: "Driver chosen", tone: "info" },
  in_progress: { label: "On the way", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function JobRow({ j }: { j: { id: string; material: string; custom_material: string | null; quantity_m3: number; delivery_address: string; budget: number; final_price?: number | null; status: string } }) {
  const st = ROW_STATUS[j.status] ?? { label: j.status, tone: "neutral" as const };
  return (
    <Link
      to="/jobs/$id"
      params={{ id: j.id }}
      className="flex items-center gap-3 rounded-[16px] border border-cz-border bg-cz-surface px-4 py-3.5 hover:border-cz-border-strong"
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">
          {materialLabel(j.material as never, j.custom_material)} · {Number(j.quantity_m3)} m³
        </div>
        <div className="text-[13px] text-cz-muted truncate">{j.delivery_address}</div>
        <div className="mt-1.5">
          <StatusPill tone={st.tone} className="px-2.5 py-0.5 text-xs">{st.label}</StatusPill>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="cz-display font-bold text-2xl tabular-nums">{usd(Number(j.final_price ?? j.budget))}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-cz-faint shrink-0" />
    </Link>
  );
}
