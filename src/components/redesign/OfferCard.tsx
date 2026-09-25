import type { ReactNode } from "react";
import { ShieldCheck, Star, Truck } from "lucide-react";
import { levelInfo } from "@/lib/domain";
import { cn } from "@/lib/utils";
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
  profile?: { full_name?: string | null; avatar_url?: string | null } | null;
  driver?: {
    rating_avg?: number | null;
    rating_count?: number | null;
    level?: string | null;
    jobs_completed?: number | null;
    verification_status?: string | null;
  } | null;
};

/**
 * Customer "driver offers" card (C3). The Choose button calls whatever the
 * parent passes — the existing `accept_bid` RPC. `children` is a slot for
 * the existing counter-offer controls.
 */
export function OfferCard({
  bid,
  best,
  primary,
  onChoose,
  chooseId,
  children,
}: {
  bid: OfferBid;
  best?: boolean;
  primary?: boolean;
  onChoose?: () => void;
  chooseId?: string;
  children?: ReactNode;
}) {
  const name = bid.profile?.full_name ?? "Driver";
  const first = name.split(" ")[0];
  const verified = bid.driver?.verification_status === "verified";
  return (
    <div className={cn("rounded-[18px] border bg-cz-surface p-4", best ? "border-cz-amber" : "border-cz-border")}>
      <div className="flex items-start gap-3">
        <InitialsAvatar name={name} src={bid.profile?.avatar_url} size={46} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-cz-muted">
            {verified ? (
              <span className="inline-flex items-center gap-1 font-semibold text-cz-green-text">
                <ShieldCheck className="w-3.5 h-3.5" /> Verified
              </span>
            ) : (
              <span>Not yet verified</span>
            )}
            {bid.driver && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="w-3.5 h-3.5 fill-cz-amber text-cz-amber" />
                {Number(bid.driver.rating_avg || 0).toFixed(1)}
                <span className="text-cz-faint">({bid.driver.rating_count ?? 0})</span>
              </span>
            )}
            {bid.driver?.level && <span>{levelInfo(bid.driver.level).label}</span>}
            {bid.driver && <span>{bid.driver.jobs_completed ?? 0} jobs</span>}
          </div>
          {bid.truck_reg && (
            <div className="mt-1 flex items-center gap-1 text-[13px] text-cz-muted">
              <Truck className="w-3.5 h-3.5" /> {bid.truck_reg}
              {bid.capacity_m3_snapshot ? ` · ${bid.capacity_m3_snapshot} m³ truck` : ""}
              {Number(bid.estimated_trips) > 1 ? ` · ${bid.estimated_trips} trips` : ""}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className={cn("cz-display font-bold text-[30px] leading-none tabular-nums", best ? "text-cz-amber" : "text-cz-text")}>
            {usd(Number(bid.price))}
          </div>
          {best && <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-cz-amber-text">Best price</div>}
          {bid.delivery_date && <div className="mt-1 text-[11px] text-cz-muted">{bid.delivery_date}</div>}
        </div>
      </div>

      {bid.message && <p className="mt-2.5 text-sm text-cz-muted">"{bid.message}"</p>}

      {bid.counter_status === "countered" && (
        <div className="mt-3 rounded-xl bg-cz-amber-tint px-3 py-2.5 text-[13px]">
          <div className="font-semibold text-cz-amber-text">Your counter-offer: {usd(Number(bid.customer_counter_price))}</div>
          <div className="text-cz-muted">Waiting for {first} to respond.</div>
        </div>
      )}
      {bid.counter_status === "driver_rejected" && (
        <p className="mt-2.5 text-[13px] italic text-cz-muted">
          {first} declined your counter of {usd(Number(bid.customer_counter_price))} — their price still stands.
        </p>
      )}

      {onChoose &&
        (primary ? (
          <button id={chooseId} type="button" onClick={onChoose} className={czButtonClass("primary", "md", "mt-3.5")}>
            Choose {first}
          </button>
        ) : (
          <div className="mt-2 flex justify-end">
            <button
              id={chooseId}
              type="button"
              onClick={onChoose}
              className="min-h-11 px-3 text-[15px] font-bold text-cz-amber hover:underline underline-offset-2"
            >
              Choose
            </button>
          </div>
        ))}
      {children}
    </div>
  );
}
