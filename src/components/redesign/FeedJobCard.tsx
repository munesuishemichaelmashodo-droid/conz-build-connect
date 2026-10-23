import { Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck, Star } from "lucide-react";
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
        "rounded-2xl border bg-cz-surface p-4 flex flex-col gap-3.5",
        highlight ? "border-cz-amber" : "border-cz-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <MaterialBadge highlight={!!highlight}>
          {materialLabel(job.material as never, job.custom_material)} · {Number(job.quantity_m3)} m³
        </MaterialBadge>
        {job.created_at && (
          <span className="text-[13px] text-cz-muted shrink-0">{timeAgo(job.created_at)}</span>
        )}
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
          className={cn("text-[13px]", far ? "font-semibold text-cz-amber-text" : "text-cz-muted")}
          data-testid="job-distance"
        >
          {far ? "Far from you · " : ""}
          {distanceText}
        </p>
      )}

      <div className="flex items-end justify-between gap-3 border-t border-cz-border pt-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-cz-muted">Customer's price</span>
          <span className="cz-display font-bold text-[34px] leading-none tabular-nums">
            {usd(price)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 text-right min-w-0">
          {escrow && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-cz-green-text">
              <ShieldCheck className="w-3.5 h-3.5" /> Con Z Pay job
            </span>
          )}
          {matchTier && MATCH_LABEL[matchTier] && (
            <span className="text-[13px] text-cz-muted truncate max-w-[180px]">
              {MATCH_LABEL[matchTier]}
            </span>
          )}
          {customer?.first_name && (
            <span className="inline-flex items-center gap-1 text-[13px] text-cz-muted">
              {customer.first_name}
              {Number(customer.rating_count) > 0 && (
                <>
                  {" · "}
                  <Star className="w-3 h-3 fill-cz-amber text-cz-amber-text" />
                  {Number(customer.rating_avg).toFixed(1)}
                </>
              )}
            </span>
          )}
          {!escrow && <span className="text-[13px] text-cz-muted">Customer pays you directly</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {onAccept ? (
          <button
            type="button"
            onClick={onAccept}
            disabled={accepting}
            className={czButtonClass(
              "primary",
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
            "secondary",
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
