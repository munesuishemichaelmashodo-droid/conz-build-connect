import type { ReactNode } from "react";
import { parseOfferMessage } from "@/lib/proposed-source";
import { ShieldCheck, Star } from "lucide-react";
import { mmss, useSecondsLeft } from "@/components/redesign/rpc";
import { levelInfo } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { estimateDeliveryMinutes, formatDuration, presenceOf } from "@/lib/delivery-time";
import { ratingLabel } from "@/lib/driver-onboarding";
import { tripsLabel, type GuideBand } from "@/lib/offer-compare";
import { InitialsAvatar, czButtonClass, usd } from "@/components/redesign";

export type OfferBid = {
  id: string;
  price: number;
  status: string;
  counter_status?: string | null;
  customer_counter_price?: number | null;
  delivery_date?: string | null;
  message?: string | null;
  truck_reg?: string | null;
  capacity_m3_snapshot?: number | null;
  estimated_trips?: number | null;
  /** "I can reach pickup in" minutes (migration 0060). */
  eta_minutes?: number | null;
  /** Offer validity (migration 0062). */
  expires_at?: string | null;
  profile?: {
    full_name?: string | null;
    avatar_url?: string | null;
    last_active_at?: string | null;
  } | null;
  driver?: {
    rating_avg?: number | null;
    rating_count?: number | null;
    level?: string | null;
    jobs_completed?: number | null;
    verification_status?: string | null;
  } | null;
};

// Keep each number with its unit so "1 hr 30 min" breaks as "1 hr / 30 min".
const keepUnits = (text: string) => text.replace(/(\d) /g, "$1\u00a0");

const BAND_CLASS: Record<GuideBand["kind"], string> = {
  within: "text-cz-muted",
  below: "text-cz-muted",
  above: "text-cz-warn-text",
};

/**
 * One driver's offer on the customer's offers screen. The three fact cells sit in
 * the same place on every card so offers can be compared by scanning down the list.
 * The Choose button calls whatever the parent passes (the existing `accept_bid`
 * RPC); `footer` is a slot for the existing counter-offer control.
 */
export function OfferCard({
  bid,
  primary,
  highlights = [],
  guide,
  onChoose,
  chooseId,
  footer,
  kmToPickup,
  deliveryKm,
}: {
  bid: OfferBid;
  /** The one filled Choose button on the screen. */
  primary?: boolean;
  highlights?: string[];
  guide?: GuideBand | null;
  onChoose?: () => void;
  chooseId?: string;
  footer?: ReactNode;
  /** Approximate distance of an Online driver from pickup (migration 0062). */
  kmToPickup?: number | null;
  /** Pickup → delivery road distance, for the estimated time at the site. */
  deliveryKm?: number | null;
}) {
  const secondsLeft = useSecondsLeft(bid.expires_at);
  const expired = secondsLeft === 0;
  const name = bid.profile?.full_name ?? "Driver";
  const first = name.split(" ")[0];
  const verified = bid.driver?.verification_status === "verified";
  const presence = presenceOf(bid.profile?.last_active_at);
  const rated = Number(bid.driver?.rating_count ?? 0) > 0;
  const eta = Number(bid.eta_minutes) > 0 ? Number(bid.eta_minutes) : null;
  const atSite = estimateDeliveryMinutes(deliveryKm, bid.eta_minutes);
  const trips = tripsLabel(bid.estimated_trips);
  const price = Number(bid.price);
  const km =
    kmToPickup != null ? (Number(kmToPickup) < 1 ? 1 : Math.round(Number(kmToPickup))) : null;

  return (
    <article
      aria-label={`Offer from ${name}, ${usd(price)}`}
      className={cn(
        "overflow-hidden rounded-2xl border bg-cz-surface",
        primary && !expired
          ? "border-cz-border-strong shadow-[0_1px_0_var(--cz-border)]"
          : "border-cz-border",
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <InitialsAvatar name={name} src={bid.profile?.avatar_url} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold">{name}</span>
            {presence.online && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-cz-muted">
                <span aria-hidden className="h-2 w-2 rounded-full bg-cz-green" />
                Online
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-cz-muted">
            {verified ? (
              <span className="inline-flex items-center gap-1 font-semibold text-cz-green-text">
                <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> Verified
              </span>
            ) : (
              <span>Not yet verified</span>
            )}
            {bid.driver && (
              <span className="inline-flex items-center gap-1">
                {rated && (
                  <Star aria-hidden className="h-3.5 w-3.5 fill-cz-amber text-cz-amber-text" />
                )}
                {ratingLabel(bid.driver.rating_avg, bid.driver.rating_count)}
              </span>
            )}
            {bid.driver && (
              <span>
                {bid.driver.jobs_completed ?? 0}{" "}
                {Number(bid.driver.jobs_completed) === 1 ? "job" : "jobs"}
                {bid.driver.level ? `, ${levelInfo(bid.driver.level).label}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="cz-display text-[30px] font-bold leading-none tabular-nums text-cz-text">
            {usd(price)}
          </div>
          {guide && (
            <div className={cn("mt-1 text-[12px]", BAND_CLASS[guide.kind])}>{guide.text}</div>
          )}
        </div>
      </div>

      {highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-2.5">
          {highlights.map((h) => (
            <span
              key={h}
              className="rounded-full bg-cz-amber-tint px-2.5 py-0.5 text-[12px] font-semibold text-cz-amber-text"
            >
              {h}
            </span>
          ))}
        </div>
      )}

      <dl className="mx-4 mt-3 grid grid-cols-3 divide-x divide-cz-border rounded-xl bg-cz-surface-2 py-2.5">
        <Fact
          label="Pickup in"
          value={eta ? keepUnits(formatDuration(eta)) : "Not given"}
          muted={!eta}
          sub={km ? `${km} km away` : null}
        />
        <Fact
          label="At your site"
          value={atSite ? `~${keepUnits(formatDuration(atSite))}` : "Not given"}
          muted={!atSite}
          sub={bid.delivery_date ?? null}
        />
        <Fact
          label="Truck"
          value={bid.capacity_m3_snapshot ? `${Number(bid.capacity_m3_snapshot)} m³` : "Not given"}
          muted={!bid.capacity_m3_snapshot}
          sub={trips.text}
          subStrong={trips.multiple}
        />
      </dl>

      <div className="space-y-3 px-4 pb-4 pt-3">
        {(() => {
          const { source, note } = parseOfferMessage(bid.message);
          return (
            <>
              {source && (
                <p className="text-sm" data-testid="proposed-source">
                  <span className="text-cz-muted">Loads at: </span>
                  <span className="font-semibold">{source}</span>
                  <span className="block text-[12px] text-cz-muted">
                    The driver's choice, not checked by Con Z.
                  </span>
                </p>
              )}
              {note && <p className="text-sm text-cz-muted">"{note}"</p>}
            </>
          );
        })()}

        {bid.counter_status === "countered" && (
          <div className="rounded-xl bg-cz-amber-tint px-3 py-2.5 text-[13px]">
            <div className="font-semibold text-cz-amber-text">
              Your counter-offer: {usd(Number(bid.customer_counter_price))}
            </div>
            <div className="text-cz-muted">Waiting for {first} to respond.</div>
          </div>
        )}
        {bid.counter_status === "driver_rejected" && (
          <p className="text-[13px] text-cz-muted">
            {first} declined your counter of {usd(Number(bid.customer_counter_price))}. Their price
            still stands.
          </p>
        )}

        {onChoose && !expired && (
          <button
            id={chooseId}
            type="button"
            onClick={onChoose}
            className={czButtonClass(primary ? "primary" : "ghost", "md")}
          >
            Choose {first} for {usd(price)}
          </button>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {secondsLeft != null && (
            <span
              className={cn(
                "text-xs",
                expired ? "font-semibold text-cz-danger-text" : "text-cz-faint",
              )}
            >
              {expired
                ? "Offer expired. The driver can send it again."
                : `Offer valid for ${mmss(secondsLeft)}`}
            </span>
          )}
          {footer}
        </div>
      </div>
    </article>
  );
}

function Fact({
  label,
  value,
  sub,
  muted,
  subStrong,
}: {
  label: string;
  value: string;
  sub?: string | null;
  muted?: boolean;
  subStrong?: boolean;
}) {
  return (
    <div className="min-w-0 px-2.5">
      <dt className="text-[12px] text-cz-muted">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[15px] font-semibold leading-tight tabular-nums",
          muted ? "text-cz-faint" : "text-cz-text",
        )}
      >
        {value}
      </dd>
      {sub && (
        <dd
          className={cn(
            "truncate text-[12px]",
            subStrong ? "font-semibold text-cz-warn-text" : "text-cz-muted",
          )}
        >
          {sub}
        </dd>
      )}
    </div>
  );
}
