// Rules for comparing driver offers on the customer's offers screen. Display only:
// sorting and labels never change which offers exist or what accept_bid does.

export type OfferSort = "price" | "pickup" | "rating";

export const OFFER_SORTS: { value: OfferSort; label: string }[] = [
  { value: "price", label: "Lowest price" },
  { value: "pickup", label: "Soonest" },
  { value: "rating", label: "Top rated" },
];

type Comparable = {
  id: string;
  price: number | string;
  eta_minutes?: number | null;
  driver?: { rating_avg?: number | null; rating_count?: number | null } | null;
};

const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));

/** A new array in the chosen order. Ties fall back to price, then the original order. */
export function sortOffers<T extends Comparable>(offers: T[], mode: OfferSort): T[] {
  const byPrice = (a: T, b: T) => num(a.price) - num(b.price);
  const indexed = offers.map((o, i) => ({ o, i }));
  indexed.sort((x, y) => {
    const a = x.o;
    const b = y.o;
    let d = 0;
    if (mode === "pickup") {
      const ea = num(a.eta_minutes) > 0 ? num(a.eta_minutes) : Infinity;
      const eb = num(b.eta_minutes) > 0 ? num(b.eta_minutes) : Infinity;
      d = ea === eb ? 0 : ea - eb;
    } else if (mode === "rating") {
      const ra = num(a.driver?.rating_count) > 0 ? num(a.driver?.rating_avg) : -1;
      const rb = num(b.driver?.rating_count) > 0 ? num(b.driver?.rating_avg) : -1;
      d = rb - ra || num(b.driver?.rating_count ?? 0) - num(a.driver?.rating_count ?? 0);
    }
    return d || byPrice(a, b) || x.i - y.i;
  });
  return indexed.map((x) => x.o);
}

export type GuideBand = { kind: "within" | "above" | "below"; text: string };

/**
 * Where an offer sits against the price range the server worked out for this trip
 * when it was booked (pricing_breakdown.low / high, the same numbers the booking
 * screen showed). Null when the job has no usable range.
 */
export function guideBand(
  price: number | string,
  breakdown: { low?: number | string | null; high?: number | string | null } | null | undefined,
): GuideBand | null {
  const low = num(breakdown?.low);
  const high = num(breakdown?.high);
  const p = num(price);
  if (!(low > 0) || !(high >= low) || !(p > 0)) return null;
  if (p > high) return { kind: "above", text: "Above range" };
  if (p < low) return { kind: "below", text: "Below range" };
  return { kind: "within", text: "In range" };
}

export function tripsLabel(trips: number | string | null | undefined): {
  text: string;
  multiple: boolean;
} {
  const t = Math.max(1, Math.round(num(trips) || 1));
  return { text: t === 1 ? "1 trip" : `${t} trips`, multiple: t > 1 };
}

/**
 * Short tags that help a customer compare: the lowest price and the soonest pickup.
 * Every offer tied for the best value gets the tag; no tag when all offers tie.
 */
export function offerHighlights<T extends Comparable>(live: T[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (live.length < 2) return out;
  const tag = (values: { id: string; v: number }[], label: string) => {
    if (values.length === 0) return;
    const best = Math.min(...values.map((x) => x.v));
    const winners = values.filter((x) => x.v === best);
    if (winners.length === live.length) return;
    for (const w of winners) (out[w.id] ??= []).push(label);
  };
  tag(
    live.filter((o) => num(o.price) > 0).map((o) => ({ id: o.id, v: num(o.price) })),
    "Lowest price",
  );
  tag(
    live.filter((o) => num(o.eta_minutes) > 0).map((o) => ({ id: o.id, v: num(o.eta_minutes) })),
    "Soonest pickup",
  );
  return out;
}

/** One line saying what every offer's price covers, from the job's stored breakdown. */
export function priceCoversLine(
  breakdown:
    | { material_component?: number | string | null; transport_component?: number | string | null }
    | null
    | undefined,
  load: string,
): string | null {
  if (num(breakdown?.material_component) > 0)
    return `Each price is the total for ${load}, delivered to your site.`;
  if (num(breakdown?.transport_component) > 0) return "Each price is for delivery to your site.";
  return null;
}

/** Why an offer is no longer choosable, for the collapsed "earlier offers" list. */
export function earlierOfferNote(status: string): string {
  if (status === "pending") return "Expired. The driver can send it again.";
  if (status === "withdrawn") return "Withdrawn by the driver";
  if (status === "rejected") return "Not chosen";
  return "No longer available";
}
