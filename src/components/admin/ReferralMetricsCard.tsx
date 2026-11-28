import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

// Admin-only referral numbers from admin_referral_metrics() (0185). Counts only: no names, no money.

type Rpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type ReferralMetrics = {
  window_days: number;
  shares: { total: number; people_sharing: number; by_channel: Record<string, number> };
  signups: { customers: number; drivers: number };
  customers_first_delivery: number;
  drivers_verified: number;
  drivers_five_jobs: number;
  recognised: number;
  repeat_customers: number;
  repeat_bookings: number;
  retention: { role: "customer" | "driver"; day: number; eligible: number; active: number }[];
  review: { flagged: number; frozen: number; rejected: number; milestones_revoked: number };
  partner_benefits: { approved: number; cost: number; note: string };
  areas: {
    area: string;
    posted: number;
    with_offer: number;
    completed: number;
    no_offer: number;
    from_referred_customers: number;
  }[];
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  share_sheet: "Share",
  copy_link: "Copied link",
  copy_code: "Copied code",
};

export function retentionText(eligible: number, active: number): string {
  if (!eligible) return "–";
  return `${active}/${eligible} · ${Math.round((active / eligible) * 100)}%`;
}

export function ReferralMetricsCard() {
  const [days, setDays] = useState(90);
  const q = useQuery({
    queryKey: ["admin-referral-metrics", days],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("admin_referral_metrics", {
        _days: days,
      });
      if (error) throw error;
      return data as ReferralMetrics;
    },
  });
  const m = q.data;

  return (
    <section
      className="rounded-xl border bg-card p-4 space-y-3"
      aria-labelledby="ref-metrics-title"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" aria-hidden />
          <h3 id="ref-metrics-title" className="font-semibold text-sm">
            Referral results
          </h3>
        </div>
        <div className="flex gap-1" role="group" aria-label="Period">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={cn(
                "min-h-11 rounded-md border px-2 text-[11px] font-semibold",
                days === d ? "border-foreground bg-muted" : "text-muted-foreground",
              )}
            >
              {d === 365 ? "1 year" : `${d} days`}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : q.isError || !m ? (
        <p className="text-xs text-muted-foreground">
          Referral results are not available yet (needs migration 0185).
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Metric
              label="Shares"
              value={`${m.shares.total} by ${m.shares.people_sharing} people`}
            />
            <Metric
              label="Joined with a link"
              value={`${m.signups.customers} customers · ${m.signups.drivers} drivers`}
            />
            <Metric label="Customers' first delivery" value={String(m.customers_first_delivery)} />
            <Metric label="Invited drivers verified" value={String(m.drivers_verified)} />
            <Metric label="Invited drivers with 5 jobs" value={String(m.drivers_five_jobs)} />
            <Metric label="Referrals counted" value={String(m.recognised)} />
            <Metric
              label="Invited customers who rebooked"
              value={`${m.repeat_customers} (${m.repeat_bookings} repeat jobs)`}
            />
            <Metric
              label="Review"
              value={`${m.review.flagged} flagged · ${m.review.frozen} frozen · ${m.review.rejected} did not count · ${m.review.milestones_revoked} milestones withdrawn`}
            />
          </dl>
          {Object.keys(m.shares.by_channel).length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {Object.entries(m.shares.by_channel)
                .map(([k, v]) => `${CHANNEL_LABEL[k] ?? k}: ${v}`)
                .join(" · ")}
            </p>
          )}

          <div>
            <h4 className="text-xs font-semibold mb-1">Still active after joining</h4>
            <table className="w-full text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-medium py-1 pr-2">Invited</th>
                  <th className="text-left font-medium">30 days</th>
                  <th className="text-left font-medium">60 days</th>
                  <th className="text-left font-medium">90 days</th>
                </tr>
              </thead>
              <tbody>
                {(["customer", "driver"] as const).map((role) => (
                  <tr key={role} className="border-t">
                    <td className="py-1 pr-2">{role === "customer" ? "Customers" : "Drivers"}</td>
                    {[30, 60, 90].map((day) => {
                      const r = m.retention.find((x) => x.role === role && x.day === day);
                      return <td key={day}>{retentionText(r?.eligible ?? 0, r?.active ?? 0)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground mt-1">
              Customers: posted a job; drivers: completed a job, in the 30 days before that day.
              Only people who joined long enough ago are counted; – means not enough data yet.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold mb-1">Demand by area</h4>
            {!m.areas.length ? (
              <p className="text-[11px] text-muted-foreground">No jobs in this period.</p>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium py-1">Area</th>
                    <th className="text-right font-medium">Jobs</th>
                    <th className="text-right font-medium">No offer</th>
                    <th className="text-right font-medium">Done</th>
                    <th className="text-right font-medium">Invited customers</th>
                  </tr>
                </thead>
                <tbody>
                  {m.areas.slice(0, 12).map((a) => (
                    <tr key={a.area} className="border-t">
                      <td className="py-1">{a.area}</td>
                      <td className="text-right">{a.posted}</td>
                      <td
                        className={cn("text-right", a.no_offer > 0 && "text-warning font-semibold")}
                      >
                        {a.no_offer}
                      </td>
                      <td className="text-right">{a.completed}</td>
                      <td className="text-right">{a.from_referred_customers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              "No offer" = jobs no driver offered on: a sign that drivers are short there. Areas
              with fewer than 5 jobs are grouped. Nothing here starts a campaign automatically.
            </p>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Partner benefits: {m.partner_benefits.note}
          </p>
        </>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold mt-0.5">{value}</dd>
    </div>
  );
}
