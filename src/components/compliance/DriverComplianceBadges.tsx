import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BADGE_NOTE, badgeLabel, type ComplianceBadgeRow } from "@/lib/compliance";

type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Checked, unexpired documents of the assigned driver (0191). Shows nothing when there are none or before 0191. */
export function DriverComplianceBadges({ driverId }: { driverId: string }) {
  const { data } = useQuery({
    queryKey: ["driver-compliance-badges", driverId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("driver_compliance_badges", {
        _driver: driverId,
      });
      if (error) return [];
      return (data ?? []) as ComplianceBadgeRow[];
    },
  });
  if (!data?.length) return null;
  return (
    <div
      className="rounded-xl border border-cz-border bg-cz-surface px-3.5 py-3 space-y-1.5"
      data-testid="driver-compliance-badges"
    >
      <ul className="flex flex-wrap gap-1.5">
        {data.map((b) => (
          <li
            key={b.doc_type}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-success" aria-hidden />
            {badgeLabel(b)}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-cz-muted">{BADGE_NOTE}</p>
    </div>
  );
}
