import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Truck, ArrowRight } from "lucide-react";
import { materialLabel } from "@/lib/domain";

type NextLoad = {
  job_id: string;
  material: string;
  quantity_m3: number;
  pickup_address: string | null;
  delivery_address: string | null;
  budget: number | null;
  repositioning_km: number | null;
  capacity_tier: "excellent" | "good" | "oversized" | "multiple_trips" | null;
};

const TIER_LABEL: Record<string, string> = {
  excellent: "Great fit",
  good: "Good fit",
  oversized: "Oversized",
  multiple_trips: "Multiple trips",
};

/**
 * Read-only next-load / backhaul recommendation. Shown to the assigned
 * driver once their current job is in_progress or completed. Purely a
 * discovery surface — tapping a card just navigates to that job's own
 * page, where the driver bids/accepts through the completely unchanged
 * existing flow. Nothing here assigns a job automatically, and nothing
 * here can influence what the CUSTOMER on either job is charged —
 * repositioning distance is display-only, never fed into pricing.
 */
export function NextLoadsCard({ driverId, currentJobId }: { driverId: string; currentJobId: string }) {
  const navigate = useNavigate();

  const { data: loads, isLoading } = useQuery({
    queryKey: ["next-loads", driverId, currentJobId],
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

  if (isLoading || !loads || loads.length === 0) return null;

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
        {loads.map((l) => (
          <button
            key={l.job_id}
            onClick={() => navigate({ to: "/jobs/$id", params: { id: l.job_id } })}
            className="w-full text-left rounded-xl border p-3 hover:bg-muted/50 transition flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">
                {materialLabel(l.material as any, null)} — {l.quantity_m3} m³
              </div>
              <div className="text-xs text-muted-foreground truncate">
                Pickup: {l.pickup_address ?? "—"} → {l.delivery_address ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {l.repositioning_km != null ? `~${l.repositioning_km} km from this delivery` : ""}
                {l.capacity_tier ? ` · ${TIER_LABEL[l.capacity_tier] ?? l.capacity_tier}` : ""}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
