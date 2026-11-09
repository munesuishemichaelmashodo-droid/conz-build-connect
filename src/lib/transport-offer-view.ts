import type { OfferResult } from "@/lib/booking.functions";
import type { TransportOffer } from "@/lib/transport-quote.functions";

/**
 * Shows a transport-only quote on the existing offer screen. The price is the fare for the delivery trip only:
 * no material line, no supplier, no estimated arrival time (none is measured for the client's own pickup).
 */
export function transportToOfferResult(t: TransportOffer, quantity: number): OfferResult {
  return {
    status: "offer",
    offer: t.total.recommended,
    min: t.total.low,
    max: t.total.high,
    low: t.total.low,
    recommended: t.total.recommended,
    high: t.total.high,
    step: 5,
    label: "Delivery only",
    unit: "m³",
    enforced: true,
    etaMinutes: 0,
    distanceKm: t.roadKm,
    explanation: t.note,
    materialCost: 0,
    transportCost: t.total.recommended,
    tripCount: t.trips,
    referenceCapacityM3: Math.max(1, Math.min(20, Math.ceil(quantity / Math.max(1, t.trips)))),
    pricingVersion: "transport-v2-uncalibrated",
    quoteId: t.quoteId,
    openRequest: false,
    resolvedSource: null,
    dataSource: "transport",
    materialPriceUpdatedAt: null,
    assumptions: null,
  };
}

/** The fields the job row needs for a transport-priced booking. */
export function transportJobFields(
  offer: OfferResult,
  pickup: { address: string; lat: number; lng: number },
) {
  return {
    material: "custom" as const,
    quote_id: null,
    transport_quote_id: offer.quoteId,
    pricing_basis: "transport_only" as const,
    pickup_address: pickup.address.trim() || "Loading point chosen by the customer",
    pickup_lat: pickup.lat,
    pickup_lng: pickup.lng,
  };
}
