import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Calls for the RPCs added in migration 0060 (driver/customer redesign).
 * They aren't in the generated types file yet, so this keeps the one cast
 * in one place — the same pattern the app already uses for newer RPCs.
 */
type RpcResult<T> = { data: T | null; error: { message: string } | null };
// Called through `supabase.rpc(...)` (not a detached reference) so the
// client keeps its `this` binding.
const call = <T>(fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<RpcResult<T>>)(
    fn,
    args,
  );

export type OfferSummary = { others: number; min: number | null; max: number | null };
export type TodayEarnings = { earned: number; jobs: number };
export type CustomerCard = {
  job_id: string;
  first_name: string | null;
  rating_avg: number | null;
  rating_count: number | null;
};

export const withdrawBid = (bidId: string) => call<null>("withdraw_bid", { _bid_id: bidId });
export const jobOfferSummary = (jobId: string) =>
  call<OfferSummary>("job_offer_summary", { _job_id: jobId });
export const driverMarkArrived = (jobId: string, stage: "pickup" | "dropoff", arrived = true) =>
  call<string>("driver_mark_arrived", { _job_id: jobId, _stage: stage, _arrived: arrived });
export const driverTodayEarnings = () => call<TodayEarnings>("driver_today_earnings");
export const customerCards = (jobIds: string[]) =>
  call<CustomerCard[]>("customer_cards", { _job_ids: jobIds });

/** First name + rating of each job's customer, keyed by job id (driver feed). */
export function useCustomerCards(jobIds: string[]) {
  const key = [...jobIds].sort().join(",");
  const { data } = useQuery({
    queryKey: ["customer-cards", key],
    enabled: jobIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await customerCards(jobIds.slice(0, 100));
      if (error) return {} as Record<string, CustomerCard>;
      return Object.fromEntries((data ?? []).map((c) => [c.job_id, c])) as Record<
        string,
        CustomerCard
      >;
    },
  });
  return data ?? {};
}

// Migration 0062 -------------------------------------------------------------
export type TruckPoint = { lat: number; lng: number };
export type BidderLocation = {
  bid_id: string;
  lat: number;
  lng: number;
  km_to_pickup: number | null;
};

export const raiseJobBudget = (jobId: string, newBudget: number) =>
  call<number>("raise_job_budget", { _job_id: jobId, _new_budget: newBudget });
export const nearbyAvailableTrucks = (lat: number, lng: number) =>
  call<TruckPoint[]>("nearby_available_trucks", { _lat: lat, _lng: lng });
export const jobBidderLocations = (jobId: string) =>
  call<BidderLocation[]>("job_bidder_locations", { _job_id: jobId });

/** Approximate (~1 km) positions of Online, verified trucks near a point. */
export function useNearbyTrucks(point: { lat: number; lng: number } | null) {
  const lat = point ? Math.round(point.lat * 100) / 100 : null;
  const lng = point ? Math.round(point.lng * 100) / 100 : null;
  const { data } = useQuery({
    queryKey: ["nearby-trucks", lat, lng],
    enabled: lat != null && lng != null,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await nearbyAvailableTrucks(lat!, lng!);
      if (error) return [] as TruckPoint[];
      return (data ?? []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    },
  });
  return data ?? [];
}

/** Rough position + distance to pickup of each Online driver who bid. */
export function useBidderLocations(jobId: string, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ["bidder-locations", jobId],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await jobBidderLocations(jobId);
      if (error) return {} as Record<string, BidderLocation>;
      return Object.fromEntries(
        (data ?? []).map((b) => [b.bid_id, { ...b, lat: Number(b.lat), lng: Number(b.lng) }]),
      ) as Record<string, BidderLocation>;
    },
  });
  return data ?? {};
}

/** Seconds left until `iso`, ticking every second; null when no expiry. */
export function useSecondsLeft(iso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [iso]);
  if (!iso) return null;
  return Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
}

export function mmss(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
