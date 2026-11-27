import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * 0195 (owner decision 27/11/2026): a driver on an accepted or in-progress job may browse jobs but cannot send
 * offers until that job is finished or cancelled, and an offer must be covered by their Commission Credit. The
 * database enforces both (trg_bids_driver_eligibility); this file only lets the screens say so before the driver
 * tries, and turns the database's refusals into plain sentences.
 */

export const BUSY_OFFER_TEXT =
  "You are on a job. You can look at jobs, and send offers again when it is finished.";

/** The driver's current accepted or in-progress job, or null. Reads only the driver's own job rows (RLS). */
export function useMyActiveJob(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["my-active-job", userId],
    enabled: !!userId && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id,status")
        .eq("driver_id", userId as string)
        .in("status", ["accepted", "in_progress"])
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return (data as { id: string; status: string } | null) ?? null;
    },
  });
}

/** A plain sentence for the database's offer refusals, or null to show the original message. */
export function driverOfferError(message: string | null | undefined): string | null {
  const m = message ?? "";
  if (m.includes("DRIVER_BUSY")) return BUSY_OFFER_TEXT;
  if (m.includes("COMMISSION_CREDIT") || /insufficient wallet balance/i.test(m)) {
    return "Your Commission Credit does not cover the commission on this offer. Top up, or offer a lower price.";
  }
  return null;
}
