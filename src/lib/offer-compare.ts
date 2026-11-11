// Rules for comparing driver offers on the customer's offers screen. Display only:
// sorting and labels never change which offers exist or what accept_bid does.

export type OfferSort = "best" | "price" | "pickup" | "rating";

export const OFFER_SORTS: { value: OfferSort; label: string }[] = [
  { value: "best", label: "Best match" },
  { value: "price", label: "Lowest price" },
  { value: "pickup", label: "Soonest" },
  { value: "rating", label: "Top rated" },
];

type Comparable = {
  id: string;
  price: number | string;
  eta_minutes?: number | null;
  /** Stored by the server when the offer was made: excellent | good | oversized | multiple_trips. */
  capacity_match_tier?: string | null;
  profile?: { last_active_at?: string | null } | null;
  driver?: {
    rating_avg?: number | null;
    rating_count?: number | null;
    jobs_completed?: number | null;
  } | null;
};

const num = (v: unknown) => (v == null || v === "" ? NaN : Number(v));

type Range = { low?: number | string | null; high?: number | string | null } | null | undefined;
const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * A transparent score for "best overall", built only from facts already on the offer card: price
 * against the booking's own range, how close to the cheapest, truck fit, rating, completed jobs and
 * how soon the driver can reach pickup. Display only, like the sorts: it never changes which offers
 * exist or what accept_bid does. Every point comes with the plain-words reason shown to the customer.
 */
export function scoreOffer(
  o: Comparable,
  ctx: { lowestPrice: number; breakdown?: Range; now?: number },
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const price = num(o.price);

  const band = guideBand(o.price, ctx.breakdown);
  if (band?.kind === "within") {
    score += 2;
    reasons.push("Within the expected price range");
  } else if (band?.kind === "above") {
    score -= 2;
  } else if (band?.kind === "below") {
    score += 1;
  }

  if (price > 0 && ctx.lowestPrice > 0) {
    if (price === ctx.lowestPrice) {
      score += 2;
      reasons.push("Lowest price");
    } else if (price <= ctx.lowestPrice * 1.1) {
      score += 1;
    }
  }

  if (o.capacity_match_tier === "excellent") {
    score += 2;
    reasons.push("Truck is a very good fit");
  } else if (o.capacity_match_tier === "good") {
    score += 1;
    reasons.push("Truck fits the load");
  } else if (o.capacity_match_tier === "multiple_trips") {
    score -= 1;
  }

  const count = num(o.driver?.rating_count);
  const avg = num(o.driver?.rating_avg);
  if (count >= 3) {
    if (avg >= 4.5) {
      score += 2;
      reasons.push(`Rated ${avg.toFixed(1)} from ${count} jobs`);
    } else if (avg >= 4.0) {
      score += 1;
      reasons.push(`Rated ${avg.toFixed(1)} from ${count} jobs`);
    } else if (avg < 3.5) {
      score -= 2;
    }
  }

  const done = num(o.driver?.jobs_completed);
  if (done >= 10) {
    score += 2;
    reasons.push(`${done} completed jobs`);
  } else if (done >= 3) {
    score += 1;
    reasons.push(`${done} completed jobs`);
  }

  const eta = num(o.eta_minutes);
  if (eta > 0 && eta <= 30) {
    score += 1;
    reasons.push(`Can reach pickup in ${eta} min`);
  }

  const seen = o.profile?.last_active_at ? new Date(o.profile.last_active_at).getTime() : NaN;
  if (Number.isFinite(seen) && (ctx.now ?? Date.now()) - seen <= ONLINE_WINDOW_MS) score += 1;

  return { score, reasons };
}

export type Recommendation = { id: string; reasons: string[] };

/**
 * The one offer that is clearly the best overall, or null. Needs two or more live offers, a score of
 * at least 3, and a lead of at least 2 over the runner-up, so a near-tie never gets a false verdict.
 */
export function recommendOffer<T extends Comparable>(
  live: T[],
  breakdown?: Range,
  now?: number,
): Recommendation | null {
  if (live.length < 2) return null;
  const prices = live.map((o) => num(o.price)).filter((p) => p > 0);
  const lowestPrice = prices.length ? Math.min(...prices) : 0;
  const scored = live
    .map((o) => ({ id: o.id, ...scoreOffer(o, { lowestPrice, breakdown, now }) }))
    .sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score < 3 || first.score - second.score < 2) return null;
  return { id: first.id, reasons: first.reasons.slice(0, 3) };
}

/**
 * A new array in the chosen order. Ties fall back to price, then the original order. "best" puts the
 * highest overall score first (the same score as recommendOffer).
 */
export function sortOffers<T extends Comparable>(
  offers: T[],
  mode: OfferSort,
  breakdown?: Range,
): T[] {
  const byPrice = (a: T, b: T) => num(a.price) - num(b.price);
  const prices = offers.map((o) => num(o.price)).filter((p) => p > 0);
  const lowestPrice = prices.length ? Math.min(...prices) : 0;
  const now = Date.now();
  const scores = new Map(
    mode === "best"
      ? offers.map((o) => [o.id, scoreOffer(o, { lowestPrice, breakdown, now }).score] as const)
      : [],
  );
  const indexed = offers.map((o, i) => ({ o, i }));
  indexed.sort((x, y) => {
    const a = x.o;
    const b = y.o;
    let d = 0;
    if (mode === "best") {
      d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
    } else if (mode === "pickup") {
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
