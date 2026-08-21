export type CapacityMatchTier = "excellent" | "good" | "oversized" | "multiple_trips";

export type CapacityMatchPreview = {
  trips: number;
  score: number;
  tier: CapacityMatchTier;
};

/**
 * Client-side preview only — mirrors tg_stamp_bid_capacity's formula
 * (migration 0045) exactly, so the driver sees an accurate match/trip
 * estimate before a bid exists to query. The server always recomputes and
 * overwrites these fields authoritatively from the actual truck_id +
 * job.quantity_m3 on insert/update — this preview can never be what
 * actually gets stored.
 *
 * This is the one place that formula is written on the frontend. If it
 * ever needs to change, it should change here only, and stay in sync with
 * tg_stamp_bid_capacity in supabase/migrations/20260820140000_0045_*.sql
 * (the database trigger remains the sole source of truth for anything
 * that's actually stored).
 */
export function previewCapacityMatch(capacityM3: number, quantityM3: number): CapacityMatchPreview | null {
  if (!capacityM3 || capacityM3 <= 0 || !quantityM3 || quantityM3 <= 0) return null;
  const trips = Math.ceil(quantityM3 / capacityM3);
  const score = quantityM3 / (trips * capacityM3);
  const tier: CapacityMatchTier =
    trips > 1 ? "multiple_trips" : score >= 0.833 ? "excellent" : score >= 0.5 ? "good" : "oversized";
  return { trips, score, tier };
}

const TIER_RANK: Record<CapacityMatchTier, number> = { excellent: 0, good: 1, oversized: 2, multiple_trips: 3 };

/**
 * Best tier across a driver's registered trucks for a given order quantity
 * — used only for job-list display/sort ordering. Every eligible job stays
 * visible and biddable regardless of rank; this never affects eligibility.
 */
export function bestCapacityMatchTier(quantityM3: number, capacities: number[]): CapacityMatchTier | null {
  if (!capacities.length || !quantityM3 || quantityM3 <= 0) return null;
  let best: { tier: CapacityMatchTier; rank: number; trips: number } | null = null;
  for (const cap of capacities) {
    const preview = previewCapacityMatch(cap, quantityM3);
    if (!preview) continue;
    const rank = TIER_RANK[preview.tier];
    if (!best || rank < best.rank || (rank === best.rank && preview.trips < best.trips)) {
      best = { tier: preview.tier, rank, trips: preview.trips };
    }
  }
  return best?.tier ?? null;
}
