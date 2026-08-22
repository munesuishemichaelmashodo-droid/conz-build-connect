import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Truck, ArrowRight, Sparkles } from "lucide-react";
import { materialLabel } from "@/lib/domain";
import { cn } from "@/lib/utils";

type RecommendationTier = "excellent" | "good" | "possible";

type NextLoad = {
  job_id: string;
  material: string;
  quantity_m3: number;
  pickup_address: string | null;
  delivery_address: string | null;
  budget: number | null;
  repositioning_km: number | null;
  next_load_km: number | null;
  empty_km_saved: number | null;
  capacity_tier: "excellent" | "good" | "oversized" | "multiple_trips" | null;
  recommendation_tier: RecommendationTier | null;
};

const CAPACITY_LABEL: Record<string, string> = {
  excellent: "Great fit",
  good: "Good fit",
  oversized: "Oversized",
  multiple_trips: "Multiple trips",
};

const TIER_META: Record<RecommendationTier, { label: string; className: string }> = {
  excellent: { label: "EXCELLENT", className: "bg-success/15 text-success" },
  good: { label: "GOOD", className: "bg-primary/15 text-primary" },
  possible: { label: "POSSIBLE", className: "bg-muted text-muted-foreground" },
};

/**
 * Read-only next-load / backhaul recommendation. Shown to the assigned
 * driver once their current job is in_progress or completed. Purely a
 * discovery surface — tapping a card just navigates to that job's own
 * page, where the driver bids/accepts through the completely unchanged
 * existing flow. Nothing here assigns a job automatically, and nothing
 * here can influence what the CUSTOMER on either job is charged —
 * empty_km_saved and every other field here is display-only, never fed
 * into compute_material_offer or any pricing path.
 *
 * empty_km_saved is an ESTIMATE, deliberately labelled as such: it uses
 * the current job's own pickup point as a conservative comparison
 * anchor (the one real, already-known prior location), not a claim
 * about the driver's true home base or intended direction.
 */
export function NextLoadsCard({ driverId, currentJobId }: { driverId: string; currentJobId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = ["next-loads", driverId, currentJobId];

  const { data: loads, isLoading } = useQuery({
    queryKey,
    // Polling fallback, matching the exact interval already used by the
    // driver job list (jobs.index.tsx). Realtime below is a freshness
    // accelerator only -- if the channel never fires for a given change
    // (dropped connection, or a row whose RLS visibility changes exactly
    // at the moment of the update -- jobs' SELECT policy only shows an
    // 'open' job to drivers who aren't its customer/assigned driver, so
    // a candidate that just got accepted by someone else may not reliably
    // reach every other driver's realtime channel), this guarantees the
    // list is still correct within one poll cycle regardless. Safe
    // either way: find_next_loads_for_driver is SECURITY DEFINER and
    // does its own authorization/eligibility check on every call, so
    // polling it never depends on the realtime/RLS edge case at all.
    refetchInterval: 4000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- find_next_loads_for_driver isn't in the generated Supabase types (fresh migration)
      const { data, error } = await (supabase.rpc as any)("find_next_loads_for_driver", {
        _driver_id: driverId,
        _current_job_id: currentJobId,
      });
      if (error) throw error;
      return (data ?? []) as NextLoad[];
    },
  });

  // Realtime freshness only, same pattern already used for the driver job
  // list (jobs.index.tsx) — reused here, not a new mechanism. If a
  // candidate job gets accepted/cancelled elsewhere, refetch from the
  // server (the authoritative source) rather than guessing from the
  // realtime payload. The refetchInterval above is the guaranteed
  // fallback; this subscription only tries to make the update visible
  // sooner than the next poll tick.
  useEffect(() => {
    if (!driverId) return;
    const ch = supabase
      .channel(`next-loads-freshness-${driverId}-${currentJobId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "jobs" }, () => {
        void queryClient.invalidateQueries({ queryKey });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, currentJobId, queryClient]);

  if (isLoading || !loads || loads.length === 0) return null;

  const top = loads[0];
  const rest = loads.slice(1);

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card space-y-3">
      <div className="flex items-center gap-2">
        <Truck className="w-4 h-4 text-primary" />
        <div className="font-display font-bold text-sm uppercase tracking-wide">Suggested next loads</div>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Other open jobs near where this delivery finishes — bid on any of them the same way as usual.
      </p>
      <div className="space-y-2">
        {loads.map((l, i) => (
          <LoadRow key={l.job_id} l={l} featured={i === 0} onOpen={() => navigate({ to: "/jobs/$id", params: { id: l.job_id } })} />
        ))}
      </div>
    </div>
  );
}

function LoadRow({ l, featured, onOpen }: { l: NextLoad; featured: boolean; onOpen: () => void }) {
  const tier = l.recommendation_tier ?? "possible";
  const meta = TIER_META[tier];
  const hasSaving = (l.empty_km_saved ?? 0) > 0;

  return (
    <button
      onClick={onOpen}
      className={cn(
        "w-full text-left rounded-xl border p-3 hover:bg-muted/50 transition space-y-1.5",
        featured && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {featured && <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />}
          <span className={cn("text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded", meta.className)}>{meta.label}</span>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </div>

      <div className="font-semibold text-sm truncate">
        {materialLabel(l.material as any, null)} — {l.quantity_m3} m³
      </div>
      <div className="text-xs text-muted-foreground truncate">
        {l.pickup_address ?? "—"} → {l.delivery_address ?? "—"}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground pt-0.5">
        {l.repositioning_km != null && <span>Pickup: ~{l.repositioning_km} km away</span>}
        {l.capacity_tier && <span>Truck fit: {CAPACITY_LABEL[l.capacity_tier] ?? l.capacity_tier}</span>}
      </div>

      {hasSaving && (
        <div className="text-xs text-success font-medium pt-0.5">
          ~{l.empty_km_saved} km of empty travel avoided (estimate)
        </div>
      )}
    </button>
  );
}
