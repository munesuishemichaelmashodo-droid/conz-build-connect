import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cancellationReasonLabel } from "@/lib/cancellation-reasons";
import { FEEDBACK_OPTIONS } from "@/lib/delivery-feedback";
import {
  METRIC_DEFINITIONS,
  formatMedianMinutes,
  formatMedianSeconds,
  formatRatio,
  type MarketplaceMetrics,
  type Ratio,
} from "@/lib/marketplace-metrics";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => PromiseLike<{ data: MarketplaceMetrics | null; error: { message: string } | null }>;

const WINDOWS = [7, 30, 90];

function RatioRow({ label, ratio, help }: { label: string; ratio: Ratio; help: string }) {
  const f = formatRatio(ratio);
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-cz-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-cz-muted">{help}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold tabular-nums">{f.raw}</div>
        <div className="text-xs text-cz-muted tabular-nums">
          {f.pct ?? "no data"}
          {f.pct && f.small ? " · small sample" : ""}
        </div>
      </div>
    </div>
  );
}

function CountRow({
  label,
  value,
  help,
}: {
  label: string;
  value: string | number;
  help?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-cz-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {help && <div className="text-xs text-cz-muted">{help}</div>}
      </div>
      <div className="text-sm font-semibold tabular-nums shrink-0">{value}</div>
    </div>
  );
}

/**
 * Is ConZ improving successful deliveries? Aggregate only (migration 0150): every rate shows its raw counts, a
 * percentage appears only when there is something to divide by, and small samples are marked. Jobs and offers are
 * separate sections. Nothing here identifies a customer or a driver.
 */
export function MarketplaceHealthCard() {
  const [days, setDays] = useState(30);
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-marketplace-metrics", days],
    queryFn: async () => {
      const r = await (supabase.rpc as unknown as Rpc)("admin_marketplace_metrics", {
        _days: days,
      });
      if (r.error) throw r.error;
      return r.data;
    },
    retry: false,
  });
  if (error) return null; // database not updated yet, or not an admin

  const m = data;
  const reasons = Object.entries(m?.jobs.cancelled_by_reason ?? {}).sort((a, b) => b[1] - a[1]);
  const answers = Object.entries(m?.feedback.by_answer ?? {}).sort((a, b) => b[1] - a[1]);
  const answerLabel = (k: string) => FEEDBACK_OPTIONS.find((o) => o.value === k)?.label ?? k;

  return (
    <section
      className="rounded-2xl border bg-card p-5 space-y-4"
      aria-labelledby="marketplace-health-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-cz-amber-text" aria-hidden />
          <h2 id="marketplace-health-title" className="font-display font-bold text-lg">
            Marketplace health
          </h2>
        </div>
        <div className="flex gap-1" role="group" aria-label="Period">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`rounded-full border px-3 py-1 text-xs ${days === w ? "bg-cz-surface-2 font-semibold" : "text-cz-muted"}`}
            >
              {w} days
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-cz-muted">
        Counts first, percentages second. Small samples are marked and should not be read as
        conclusions. Repeat requests are not the same as repeat successful deliveries.
      </p>

      {isLoading || !m ? (
        <p className="text-sm text-cz-muted">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold">Requests (jobs)</h3>
            <CountRow label="Requests created" value={m.jobs.requests_created} />
            <RatioRow
              label="Received an offer"
              ratio={m.jobs.with_offer}
              help={METRIC_DEFINITIONS.with_offer}
            />
            <CountRow
              label="Median time to first offer"
              value={formatMedianMinutes(m.jobs.median_minutes_to_first_offer)}
            />
            <RatioRow
              label="Offer accepted"
              ratio={m.jobs.offer_accepted}
              help={METRIC_DEFINITIONS.offer_accepted}
            />
            <RatioRow
              label="Delivery completed"
              ratio={m.jobs.verified_completed}
              help={METRIC_DEFINITIONS.verified_completed}
            />
            <RatioRow
              label="Cancelled"
              ratio={m.jobs.cancelled}
              help={METRIC_DEFINITIONS.cancelled}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">Why requests were cancelled</h3>
            {reasons.length === 0 ? (
              <p className="py-2 text-sm text-cz-muted">No cancellations in this period.</p>
            ) : (
              reasons.map(([k, c]) => (
                <CountRow
                  key={k}
                  label={cancellationReasonLabel(k === "unknown" ? null : k)}
                  value={c}
                />
              ))
            )}
            <RatioRow
              label="Driver no-shows (still cancelled)"
              ratio={m.jobs.no_shows}
              help={METRIC_DEFINITIONS.no_shows}
            />
            <CountRow
              label="No-show requests reopened by the customer"
              value={`${m.jobs.no_show_reopened.reopened} (${m.jobs.no_show_reopened.reopened_then_completed} later completed)`}
              help={METRIC_DEFINITIONS.no_show_reopened}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">Repeat and invitations</h3>
            <RatioRow
              label="Repeat requests"
              ratio={m.jobs.repeat_requests}
              help={METRIC_DEFINITIONS.repeat_requests}
            />
            <RatioRow
              label="Repeat completed deliveries"
              ratio={m.jobs.repeat_verified_completed}
              help={METRIC_DEFINITIONS.repeat_verified_completed}
            />
            <RatioRow
              label="Invited a previous driver"
              ratio={m.jobs.invited}
              help={METRIC_DEFINITIONS.invited}
            />
            <RatioRow
              label="Invited driver chosen"
              ratio={m.jobs.invited_chosen}
              help={METRIC_DEFINITIONS.invited_chosen}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">Dispatch offers (offers, not requests)</h3>
            <p className="text-xs text-cz-muted">{METRIC_DEFINITIONS.offers}</p>
            <CountRow label="Offers sent" value={m.offers.sent} />
            <CountRow label="Viewed" value={`${m.offers.viewed} of ${m.offers.sent}`} />
            <CountRow label="Accepted" value={`${m.offers.accepted} of ${m.offers.sent}`} />
            <CountRow label="Declined" value={`${m.offers.declined} of ${m.offers.sent}`} />
            <CountRow
              label="Expired without a response"
              value={`${m.offers.expired} of ${m.offers.sent}`}
            />
            <CountRow
              label="Median time to a response"
              value={formatMedianSeconds(m.offers.median_response_seconds)}
            />
          </div>

          <div>
            <h3 className="text-sm font-semibold">After-delivery feedback (optional)</h3>
            <p className="text-xs text-cz-muted">{METRIC_DEFINITIONS.feedback}</p>
            <CountRow
              label="Answered"
              value={`${m.feedback.answered} of ${m.feedback.eligible} completed`}
            />
            <CountRow label="Dismissed" value={m.feedback.dismissed} />
            {answers.map(([k, c]) => (
              <CountRow key={k} label={answerLabel(k)} value={c} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
