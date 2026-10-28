// Helpers for the homepage price check. Display and navigation only: the price
// itself always comes from computePublicOffer on the server.

import { isValidQuantity } from "@/lib/load-size";

export type QuickPriceInput = {
  material: string;
  quantity: number;
  coords: { lat: number; lng: number } | null;
};

/** Trims and collapses runs of whitespace; everything else (spelling, case, numbers) still counts. */
export function normalizeQuickPriceAddress(address: string): string {
  return address.trim().replace(/\s+/g, " ");
}

/**
 * Identifies the inputs a price was worked out for, so a stale price is never shown or booked.
 * Includes the delivery address: editing it must retire the old result even when the map pin
 * (and so the coordinates) did not move.
 */
export function quickPriceSignature({
  material,
  quantity,
  coords,
  address = "",
}: QuickPriceInput & { address?: string }): string {
  const where = coords ? [coords.lat.toFixed(5), coords.lng.toFixed(5)] : null;
  // JSON keeps the fields apart even if the address contains a separator character.
  return JSON.stringify([material, quantity, where, normalizeQuickPriceAddress(address)]);
}

/** The stored result, only if it was worked out for exactly the inputs on screen now. */
export function currentQuickPrice<T extends { sig: string }>(
  result: T | null,
  sig: string,
): T | null {
  return result && result.sig === sig ? result : null;
}

/**
 * Hands out request numbers so only the newest price check may change the screen. A slower,
 * older request that finishes last (or fails last) is ignored.
 */
export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (id: number) => id === latest,
  };
}
export type LatestRequestGate = ReturnType<typeof createLatestRequestGate>;

export type QuickPriceRunResult<R> = { sig: string; value?: R; error: unknown | null };

/**
 * One price check, with the React state setters passed in so the race rules can be tested
 * without a browser:
 *  - nothing starts without a delivery point and a valid quantity;
 *  - a reply is stored only if its request is still the newest AND the inputs still match it;
 *  - only the newest request may clear the "checking" state.
 * Returns whether the reply was applied.
 */
export async function runQuickPrice<R>(args: {
  gate: LatestRequestGate;
  sig: string;
  currentSig: () => string;
  hasDelivery: boolean;
  quantity: number;
  fetch: () => Promise<R>;
  setPending: (sig: string | null) => void;
  setResult: (r: QuickPriceRunResult<R>) => void;
}): Promise<"applied" | "ignored" | "not_started"> {
  if (!args.hasDelivery || !isValidQuantity(args.quantity)) return "not_started";
  const id = args.gate.begin();
  args.setPending(args.sig);
  const stillWanted = () => args.gate.isLatest(id) && args.currentSig() === args.sig;
  try {
    const value = await args.fetch();
    if (!stillWanted()) return "ignored";
    args.setResult({ sig: args.sig, value, error: null });
    return "applied";
  } catch (error) {
    if (!stillWanted()) return "ignored";
    args.setResult({ sig: args.sig, error });
    return "applied";
  } finally {
    if (args.gate.isLatest(id)) args.setPending(null);
  }
}

/**
 * The booking screen with the same details filled in. customer.book reads these
 * search params; the sign-in screen only follows same-origin paths (safeInternalPath).
 */
export function quickPriceBookingPath({
  material,
  quantity,
  address,
  coords,
}: QuickPriceInput & { address: string }): string {
  const params = new URLSearchParams({ material, quantity: String(quantity) });
  const trimmed = address.trim().slice(0, 200);
  if (trimmed) params.set("address", trimmed);
  if (coords) {
    params.set("lat", coords.lat.toFixed(6));
    params.set("lng", coords.lng.toFixed(6));
  }
  return `/customer/book?${params.toString()}`;
}

const OFFLINE = "You're offline. Check your connection and try again.";
const UNREACHABLE = "Couldn't reach Con Z. Check your connection and try again.";
const FALLBACK = "Couldn't work out a price just now. Please try again.";

/** Words for a failed price check. Server messages are already written for customers. */
export function quickPriceErrorMessage(error: unknown, offline: boolean): string {
  if (offline) return OFFLINE;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return UNREACHABLE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return FALLBACK;
}

export type QuickPriceStageKind =
  "needs_load" | "needs_delivery" | "ready" | "checking" | "estimate" | "guide" | "error";

/**
 * Where the customer is in the price check and what to tell them next.
 * "estimate" = a listed supplier and road route were found; "guide" = no listed
 * supplier covers the point, so drivers arrange pickup and the range is a guide.
 * A price stage is never returned without a delivery point.
 */
export function quickPriceStage(input: {
  quantityValid: boolean;
  hasDelivery: boolean;
  loading: boolean;
  result: { offer?: { openRequest: boolean }; error?: string } | null;
}): { kind: QuickPriceStageKind; prompt: string } {
  if (!input.quantityValid)
    return { kind: "needs_load", prompt: "Choose a load size to continue." };
  if (!input.hasDelivery)
    return {
      kind: "needs_delivery",
      prompt: "Where should we deliver? Add your delivery location to see an estimate.",
    };
  if (input.loading) return { kind: "checking", prompt: "Finding a supplier and the road route…" };
  if (input.result?.error) return { kind: "error", prompt: input.result.error };
  if (input.result?.offer)
    return input.result.offer.openRequest
      ? { kind: "guide", prompt: "Guide range only. Drivers set the final price." }
      : { kind: "estimate", prompt: "Estimate from a listed supplier and the road distance." };
  return {
    kind: "ready",
    prompt: "We'll find a listed supplier near this point and price the road trip.",
  };
}

/**
 * Words under a price-check result. "supplier": a listed supplier covers the site, so there is an
 * estimate; "open": no listed supplier, so drivers arrange the material and there is only a guide range.
 * Nothing here may promise a confirmed price, a supplier's availability, or a charge-free flow beyond
 * what the app does (posting a request charges nothing; money moves only after an offer is accepted).
 */
export function quickPriceCopy(kind: "supplier" | "open") {
  return kind === "supplier"
    ? {
        cta: "Book this delivery",
        next: "Free account. Your material, load and address carry over, and you check everything before posting. Posting a request doesn't charge you.",
        note: "This is an estimate, not a confirmed driver offer. Drivers send their own prices and you see each driver's total before you accept. Nothing is charged until you accept an offer.",
      }
    : {
        cta: "Request driver offers",
        next: "Free account. Your material, load and address carry over. Posting a request doesn't charge you; drivers send offers you can accept or ignore.",
        note: null,
      };
}

/**
 * Material + delivery split, shown only when it adds up to the estimate (within its rounding step).
 * A minimum charge or market-based price can make the parts differ from the total; then nothing is shown
 * rather than a breakdown that contradicts the headline number.
 */
export function offerBreakdown(offer: {
  offer: number;
  materialCost: number | null;
  transportCost: number | null;
  step?: number;
}): { material: number; delivery: number } | null {
  const m = Number(offer.materialCost);
  const t = Number(offer.transportCost);
  if (!(m > 0) || !(t > 0)) return null;
  const tolerance = Math.max(Number(offer.step) || 0, 1);
  return Math.abs(m + t - offer.offer) <= tolerance ? { material: m, delivery: t } : null;
}
