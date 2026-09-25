import { useQuery } from "@tanstack/react-query";
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
