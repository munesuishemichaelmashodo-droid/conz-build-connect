import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/ui-bits";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Briefcase, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobCard } from "@/components/JobCard";
import { bestCapacityMatchTier, type CapacityMatchTier } from "@/lib/capacityMatch";

export const Route = createFileRoute("/_authenticated/jobs/")({
  component: JobsPage,
});

const TIER_RANK: Record<CapacityMatchTier, number> = { excellent: 0, good: 1, oversized: 2, multiple_trips: 3 };

function JobsPage() {
  const { userId, is } = useAuth();
  const isDriver = is("driver");
  const isCustomer = is("customer");
  const queryClient = useQueryClient();

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

  return (
    <AppShell title="Jobs" action={isCustomer ? (
      <Button asChild size="sm" className="h-8"><Link to="/jobs/new"><Plus className="w-4 h-4 mr-1" />New</Link></Button>
    ) : undefined}>
      <div id="tour-jobs-list">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-10">Loading…</div>
        ) : (orderedJobs ?? []).length === 0 ? (
          <EmptyState icon={Briefcase} title="No jobs yet" hint={isCustomer ? "Post your first delivery request." : "Check back soon for open requests."} />
        ) : (
          <div className="space-y-2">
            {orderedJobs!.map((j) => (
              <JobCard
                key={j.id}
                j={j}
                matchTier={isDriver && myTrucks?.length ? bestCapacityMatchTier(Number(j.quantity_m3), myTrucks) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
