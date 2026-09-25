import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { previewCapacityMatch } from "@/lib/capacityMatch";
import { usd } from "@/components/redesign";

type Truck = { id: string; registration: string; capacity_m3: number };
type Funds = { ok: boolean; required?: number; available?: number; shortfall?: number; free?: boolean; reason?: string };

/**
 * One-tap "Accept $X" from the driver job feed.
 *
 * This is NOT a new bidding path: it submits exactly the bid the existing
 * job-page BidForm submits (same `bids` upsert, same columns, same
 * onConflict), with the price set to the customer's offer and the truck
 * picked by the same default rule BidForm uses (single truck, or the
 * best-matched one). It also honours the same pre-checks BidForm enforces
 * before letting a driver submit — a registered truck and the
 * `driver_can_accept_for` commission-funds check — and sends the driver to
 * the job page (where the full form is) whenever one of them fails.
 */
export function useQuickAccept() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const accept = async (job: { id: string; budget: number; quantity_m3: number }) => {
    if (!userId || busyJobId) return;
    setBusyJobId(job.id);
    try {
      // Same query + cache key as BidForm's truck list.
      const trucks = await qc.fetchQuery({
        queryKey: ["my-trucks", userId],
        queryFn: async () => {
          const { data, error } = await supabase
            .from("trucks")
            .select("id,registration,capacity_m3")
            .eq("driver_id", userId)
            .order("capacity_m3");
          if (error) throw error;
          return data as Truck[];
        },
      });
      if (!trucks?.length) {
        toast.error("Register a truck on your profile before bidding — customers see which truck will do the job.");
        nav({ to: "/jobs/$id", params: { id: job.id } });
        return;
      }
      const quantityM3 = Number(job.quantity_m3);
      const truck =
        trucks.length === 1
          ? trucks[0]
          : [...trucks].sort((a, b) => {
              const pa = previewCapacityMatch(Number(a.capacity_m3), quantityM3);
              const pb = previewCapacityMatch(Number(b.capacity_m3), quantityM3);
              return (pa?.trips ?? 99) - (pb?.trips ?? 99) || Number(a.capacity_m3) - Number(b.capacity_m3);
            })[0];

      // Same upfront commission-funds check (and cache key) as BidForm.
      const funds = await qc.fetchQuery({
        queryKey: ["can-accept-for", job.id, userId],
        queryFn: async () => {
          const { data, error } = await (supabase as any).rpc("driver_can_accept_for", {
            _job_id: job.id,
            _driver_id: userId,
          });
          if (error) throw error;
          return data as Funds;
        },
      });
      const shortfall = Number(funds?.shortfall ?? 0);
      if (funds && funds.ok === false && !funds.free && shortfall > 0) {
        toast.error(`Top up ${usd(shortfall)} to take this job — commission is reserved when a bid is accepted.`);
        nav({ to: "/jobs/$id", params: { id: job.id } });
        return;
      }

      const price = Number(job.budget);
      const { error } = await supabase.from("bids").upsert(
        {
          job_id: job.id,
          driver_id: userId,
          price,
          delivery_date: null,
          message: null,
          truck_id: truck.id,
        } as any,
        { onConflict: "job_id,driver_id" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Offer sent · ${usd(price)}`);
      qc.invalidateQueries({ queryKey: ["bids", job.id] });
      nav({ to: "/jobs/$id", params: { id: job.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send your offer");
    } finally {
      setBusyJobId(null);
    }
  };

  return { accept, busyJobId };
}
