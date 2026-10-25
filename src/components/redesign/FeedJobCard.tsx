import { Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck, Star } from "lucide-react";
import { StatusStamp } from "@/components/ds";
import type { CustomerCard } from "@/components/redesign/rpc";
import { materialLabel } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { distanceLabel, jobDistance, type DriverFix } from "@/lib/jobDistance";
import {
  MaterialBadge,
  RouteStops,
  czButtonClass,
  straightKm,
  timeAgo,
  usd,
} from "@/components/redesign";

export type FeedJob = {
  id: string;
  material: string;
  custom_material: string | null;
  quantity_m3: number;
  delivery_address: string;
  budget: number;
  status: string;
  created_at?: string;
  payment_method?: string | null;
  pickup_address?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
};

// One small tag per fact about the load, wrapping on narrow screens.
const FACT =
  "inline-flex min-h-7 items-center gap-1 rounded-md bg-cz-surface-2 px-2 text-[13px] text-cz-muted";

const MATCH_LABEL: Record<string, string> = {
  excellent: "Great fit for your truck",
  good: "Good fit for your truck",
  oversized: "Your truck is oversized",
  multiple_trips: "Needs multiple trips",
};

/**
 * Driver job-feed card (D1). Presentational: "Accept" calls whatever the
 * parent passes (the existing bid upsert at the customer's price), "Offer
 * your price" opens the job page where the existing bid form lives.
 */
export function FeedJobCard({
  job,
  onAccept,
  accepting,
  matchTier,
  highlight,
  customer,
  driverFix,
}: {
  job: FeedJob;
  onAccept?: () => void;
  accepting?: boolean;
  matchTier?: string | null;
  highlight?: boolean;
  /** First name + rating from customer_cards() (migration 0060). */
  customer?: CustomerCard;
  /** The driver's own last availability position (null = none on record). */
  driverFix?: DriverFix;
}) {
  const distance = jobDistance(driverFix ?? null, job);
  const distanceText = distanceLabel(distance);
  const far = distance.status === "ok" && distance.far;
  const km = straightKm(
    { lat: job.pickup_lat, lng: job.pickup_lng },
    { lat: job.delivery_lat, lng: job.delivery_lng },
  );
  const price = Number(job.budget);
  const escrow = job.payment_method === "escrow";
  return (
    <article
      className={cn(
        // Cards in a feed carry no orange: the price and route are the content.
        "rounded-2xl border border-cz-border bg-cz-surface p-4 flex flex-col gap-3.5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <MaterialBadge material={job.material}>
          {materialLabel(job.material as never, job.custom_material)} · {Number(job.quantity_m3)} m³
        </MaterialBadge>
        <span className="flex shrink-0 items-center gap-2">
          {highlight && (
            <StatusStamp tone="info" icon="open">
              Newest
            </StatusStamp>
          )}
          {job.created_at && (
            <span className="text-[13px] text-cz-muted">{timeAgo(job.created_at)}</span>
          )}
        </span>
      </div>

      <Link to="/jobs/$id" params={{ id: job.id }} className="block">
        <RouteStops
          pickupLabel={job.pickup_address || "Supplier pickup point"}
          dropLabel={job.delivery_address}
          dropHint={km != null ? `Drop-off · about ${Math.round(km)} km trip` : "Drop-off"}
        />
      </Link>

      {distanceText && (
        <p
          className={cn("text-[13px]", far ? "font-semibold text-cz-warn-text" : "text-cz-muted")}
          data-testid="job-distance"
        >
          {far ? "Far from you · " : ""}
          {distanceText}
        </p>
      )}

      <div className="space-y-2.5 border-t border-cz-border pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-cz-muted">Customer's price</span>
          <span className="cz-display font-bold text-[34px] leading-none tabular-nums">
            {usd(price)}
          </span>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="About this load">
          {escrow ? (
            <li className={cn(FACT, "bg-cz-green-tint font-semibold text-cz-green-text")}>
              <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> Con Z Pay job
            </li>
          ) : (
            <li className={FACT}>Customer pays you directly</li>
          )}
          {matchTier && MATCH_LABEL[matchTier] && (
            <li
              className={cn(
                FACT,
                matchTier === "oversized" || matchTier === "multiple_trips"
                  ? "bg-cz-warn-tint text-cz-warn-text"
                  : undefined,
              )}
            >
              {MATCH_LABEL[matchTier]}
            </li>
          )}
          {customer?.first_name && (
            <li className={FACT}>
              {customer.first_name}
              {Number(customer.rating_count) > 0 && (
                <>
                  <Star aria-hidden className="ml-1 h-3 w-3 fill-cz-amber text-cz-amber-text" />
                  <span className="sr-only">rated</span>
                  {Number(customer.rating_avg).toFixed(1)}
                </>
              )}
            </li>
          )}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {onAccept ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={accepting}
            // Neutral: a feed shows many jobs, so no orange button per card.
            className={czButtonClass(
              "secondary",
              "md",
              "min-h-[50px] px-2 text-[15px] whitespace-nowrap",
            )}
          >
            {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : `Accept ${usd(price)}`}
          </button>
        ) : (
          <span />
        )}
        <Link
          to="/jobs/$id"
          params={{ id: job.id }}
          className={czButtonClass(
            "ghost",
            "md",
            "min-h-[50px] px-2 text-[15px] whitespace-nowrap",
          )}
        >
          Offer your price
        </Link>
      </div>
    </article>
  );
}
