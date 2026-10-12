import { useState } from "react";
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
        className="rounded-xl border border-green-500/40 bg-green-500/5 p-3 text-[13px]"
        data-testid="supply-confirmed"
      >
        <div className="font-semibold">{supplyConfirmedCopy(confirmation.confirmed_by_role)}</div>
        {confirmation.note && <div className="text-cz-muted">{confirmation.note}</div>}
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
      className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-[13px] space-y-2"
      data-testid="supply-unconfirmed"
    >
      <div>
        <div className="font-semibold">{copy.title}</div>
        <div className="text-cz-muted">{copy.detail}</div>
      </div>
      {canConfirm && (
        <div className="space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Where are you loading? (optional note)"
            className="w-full rounded-lg border bg-background p-2 text-sm"
            aria-label="Supply note"
          />
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="w-full min-h-11 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            {busy ? "Confirming…" : "Confirm supply is secured"}
          </button>
        </div>
      )}
    </div>
  );
}
