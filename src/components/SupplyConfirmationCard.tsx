import { useState } from "react";
import { CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { stockStatusCopy, supplyConfirmedCopy } from "@/lib/stockStatus";

type Props = {
  job: {
    id: string;
    status: string;
    quantity_m3: number | string;
    supply_location_id?: string | null;
  };
  /** Who is looking. Customers only read; the assigned driver and admins can confirm. */
  viewer: "customer" | "driver" | "admin";
};

/**
 * Shows whether the supply for an active job is CONFIRMED (0104) or still only an estimate (0101).
 * "Confirmed" is shown only after an explicit confirmation by the assigned driver or an admin — never inferred
 * from recorded stock.
 */
export function SupplyConfirmationCard({ job, viewer }: Props) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The optional note only appears once the driver chooses to confirm, so an
  // advisory check does not compete with the stage's main action.
  const [confirming, setConfirming] = useState(false);
  const active = job.status === "accepted" || job.status === "in_progress";

  const { data: confirmation } = useQuery({
    queryKey: ["job-supply-confirmation", job.id],
    enabled: active || job.status === "completed",
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table added by 0104, not in generated types yet
      const { data } = await (supabase as any)
        .from("job_supply_confirmations")
        .select("confirmed_by_role, note, confirmed_at")
        .eq("job_id", job.id)
        .maybeSingle();
      return (data ?? null) as {
        confirmed_by_role: string;
        note: string | null;
        confirmed_at: string;
      } | null;
    },
  });

  const { data: stockStatus } = useQuery({
    queryKey: ["job-stock-status", job.id, job.supply_location_id, String(job.quantity_m3)],
    enabled: active && !confirmation && !!job.supply_location_id,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- function added by 0101, not in generated types yet
      const { data, error } = await (supabase as any).rpc("supply_stock_status", {
        _location_id: job.supply_location_id,
        _quantity: Number(job.quantity_m3),
      });
      return error ? "unknown" : (data as string);
    },
  });

  if (!active && !confirmation) return null;

  if (confirmation) {
    return (
      <div
        className="flex items-start gap-3 rounded-[14px] border border-cz-border bg-cz-surface px-3.5 py-3 text-[13px]"
        data-testid="supply-confirmed"
      >
        <CheckCircle2 aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-cz-green" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            Supply <span className="text-cz-green-text">· Confirmed</span>
          </div>
          <div className="text-cz-muted">{supplyConfirmedCopy(confirmation.confirmed_by_role)}</div>
          {confirmation.note && <div className="text-cz-muted">{confirmation.note}</div>}
        </div>
      </div>
    );
  }

  const copy = stockStatusCopy(stockStatus);
  const canConfirm = viewer === "driver" || viewer === "admin";

  const confirm = async () => {
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- function added by 0104, not in generated types yet
    const { error } = await (supabase as any).rpc("confirm_job_supply", {
      _job_id: job.id,
      _note: note.trim() || null,
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Supply confirmed — the customer has been told");
    setNote("");
    void qc.invalidateQueries({ queryKey: ["job-supply-confirmation", job.id] });
  };

  return (
    <div
      className="rounded-[14px] border border-cz-border bg-cz-surface px-3.5 py-3 text-[13px] space-y-2.5"
      data-testid="supply-unconfirmed"
    >
      <div className="flex items-start gap-3">
        <CircleDashed aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-cz-amber" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            Supply <span className="text-cz-amber-text">· Not confirmed</span>
          </div>
          <div className="text-cz-muted">{copy.detail}</div>
        </div>
        {canConfirm && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-11 shrink-0 rounded-xl border border-cz-border-strong px-3 text-sm font-semibold"
          >
            Confirm
          </button>
        )}
      </div>
      {canConfirm && confirming && (
        <div className="space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Where are you loading? (optional)"
            className="w-full min-h-11 rounded-xl border border-cz-border bg-cz-bg px-3 text-sm"
            aria-label="Supply note"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-11 rounded-xl border border-cz-border-strong text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="min-h-11 rounded-xl border-[1.5px] border-cz-amber text-sm font-bold text-cz-amber disabled:opacity-50"
            >
              {busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Supply is secured"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
