// Presentation rules for admin_marketplace_metrics (migration 0150). The database returns counts as { n, d }
// pairs; this decides how they are shown: always the raw counts, a percentage only when there is a denominator,
// and a "small sample" flag so an unstable percentage is never presented as a conclusion.

export const SMALL_SAMPLE_BELOW = 20;

export type Ratio = { n: number; d: number };

export function formatRatio(r: Ratio | null | undefined): { raw: string; pct: string | null; small: boolean } {
  const n = Number(r?.n ?? 0);
  const d = Number(r?.d ?? 0);
  return {
    raw: `${n} of ${d}`,
    pct: d > 0 ? `${Math.round((n / d) * 100)}%` : null,
    small: d < SMALL_SAMPLE_BELOW,
  };
}

export type MarketplaceMetrics = {
  window_days: number;
  generated_at: string;
  jobs: {
    requests_created: number;
    with_offer: Ratio;
    median_minutes_to_first_offer: number | null;
    offer_accepted: Ratio;
    verified_completed: Ratio;
    cancelled: Ratio;
    cancelled_by_reason: Record<string, number>;
    no_shows: Ratio;
    no_show_reopened: { reopened: number; reopened_then_completed: number };
    repeat_requests: Ratio;
    repeat_verified_completed: Ratio;
    invited: Ratio;
    invited_bid_received: Ratio;
    invited_chosen: Ratio;
  };
  feedback: { eligible: number; answered: number; dismissed: number; by_answer: Record<string, number> };
  offers: {
    sent: number;
    viewed: number;
    accepted: number;
    declined: number;
    expired: number;
    median_response_seconds: number | null;
  };
};

/** Numerator and denominator in words, shown beside each rate. Jobs and offers are never mixed. */
export const METRIC_DEFINITIONS: Record<string, string> = {
  with_offer: "Requests that received at least one driver offer, out of all requests created in the period.",
  offer_accepted: "Requests where the customer accepted an offer, out of requests that received at least one offer.",
  verified_completed: "Deliveries completed through the normal confirmation flow, out of all requests created.",
  cancelled: "Requests now cancelled, out of all requests created.",
  no_shows: "Cancelled by the 24-hour driver no-show check and still cancelled, out of all requests created. Reopened ones are counted under reopenings.",
  no_show_reopened: "Requests the customer reopened after a driver no-show, and how many of those were later completed. A reopening is not a new request.",
  repeat_requests: "Requests from customers who already had an earlier completed delivery. Retries after a failed request are included, so this is not loyalty on its own.",
  repeat_verified_completed: "Completed deliveries by customers with an earlier completed delivery, out of all completed deliveries.",
  invited: "Requests that invited a previous driver to bid, out of all requests created.",
  invited_chosen: "Invited driver ended up assigned, out of requests that invited a driver.",
  feedback: "Optional answers after completed deliveries. Customers can skip, so this is not every customer's view.",
  offers: "Dispatch offers sent to drivers in the period (offers, not requests). Declined and expired are counted separately from accepted.",
};

export function formatMedianMinutes(m: number | null | undefined): string {
  if (m == null) return "No data yet";
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

export function formatMedianSeconds(s: number | null | undefined): string {
  if (s == null) return "No data yet";
  if (s < 90) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}
