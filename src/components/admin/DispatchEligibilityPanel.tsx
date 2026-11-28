import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  driver_id: string;
  driver_name: string | null;
  pickup_km: number | null;
  current_radius_km: number | null;
  eligible_now: boolean;
  reasons: string[];
  invitation_status: string | null;
};
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const REASON_TEXT: Record<string, string> = {
  not_verified: "not verified",
  reverification_due: "re-check due",
  account_inactive: "account not active",
  restricted: "restricted",
  credit_account_limited: "credit account limited",
  offline: "offline",
  location_stale: "location older than 15 min",
  no_truck: "no truck registered",
  truck_type_mismatch: "truck type does not match",
  own_job: "own job",
  busy: "on another job",
  insufficient_commission_credit: "credit does not cover the commission",
  job_has_no_location: "job has no location",
  outside_current_radius: "outside the current search radius",
  job_not_open: "job not open",
};

/**
 * 0195: why each driver was or was not invited to this job (admins only, read-only, admin_dispatch_eligibility).
 * Hidden when the function is not available (database without 0195) or the viewer is not an admin.
 */
export function DispatchEligibilityPanel({ jobId }: { jobId: string }) {
  const q = useQuery({
    queryKey: ["admin-dispatch-eligibility", jobId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("admin_dispatch_eligibility", {
        _job_id: jobId,
      });
      if (error) return null;
      return (data ?? []) as Row[];
    },
  });
  const rows = q.data;
  if (!rows) return null;
  const eligible = rows.filter((r) => r.eligible_now).length;
  return (
    <details className="rounded-xl border bg-card p-3 text-sm" data-testid="dispatch-eligibility">
      <summary className="cursor-pointer font-semibold">
        Driver matching: {eligible} of {rows.length} drivers can be invited
        {rows[0]?.current_radius_km != null ? ` (within ${rows[0].current_radius_km} km)` : ""}
      </summary>
      <ul className="mt-2 space-y-1">
        {rows.map((r) => (
          <li key={r.driver_id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {r.driver_name || "Driver"}
              {r.pickup_km != null
                ? ` · ${Math.round(Number(r.pickup_km))} km (straight line)`
                : ""}
            </span>
            <span className="shrink-0 text-right text-muted-foreground">
              {r.eligible_now
                ? "can be invited"
                : r.reasons.map((x) => REASON_TEXT[x] ?? x).join(", ")}
              {r.invitation_status ? ` · invitation ${r.invitation_status}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
