import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertRoadDistance } from "@/lib/roadDistance";
import { getRoute } from "@/lib/routing.functions";

/** Zimbabwe bounding box, same as the database checks. */
const lat = z.number().min(-23.0).max(-15.0);
const lng = z.number().min(25.0).max(33.5);

export const TransportQuoteInput = z.object({
  pickupLat: lat,
  pickupLng: lng,
  deliveryLat: lat,
  deliveryLng: lng,
  quantity: z.number().positive().max(1000),
});

export type TransportOffer = {
  quoteId: string;
  roadKm: number;
  trips: number;
  /** Per-trip fare guide in USD, whole job below. All values are uncalibrated estimates. */
  perTrip: { low: number; recommended: number; high: number };
  total: { low: number; recommended: number; high: number };
  calibration: "uncalibrated";
  note: string;
};

export const MAX_TRANSPORT_KM = 900;

/** Same pickup and delivery point: nothing to price (and the router would return 0 km). */
export function samePoint(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): boolean {
  return Math.abs(a.lat - b.lat) < 0.0002 && Math.abs(a.lng - b.lng) < 0.0002;
}

/**
 * Transport-only price guide for a load going from the customer's own pickup point to their delivery point.
 * The road distance is measured HERE, on the server, from the router; a straight-line figure is never used,
 * and the quote that locks the distance is written with the service role so the browser cannot influence it.
 * Refused while the owner's switch is off.
 */
export const computeTransportOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TransportQuoteInput.parse(input))
  .handler(async ({ data, context }): Promise<TransportOffer> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0158/0159 functions are newer than the generated types
    const sb = supabase as any;
    const enabled = await sb.rpc("transport_pricing_enabled");
    if (enabled.error || enabled.data !== true) {
      throw new Error("Pricing by pickup and delivery point is not available yet.");
    }
    if (
      samePoint(
        { lat: data.pickupLat, lng: data.pickupLng },
        { lat: data.deliveryLat, lng: data.deliveryLng },
      )
    ) {
      throw new Error(
        "The pickup and delivery points are the same place. Choose two different points.",
      );
    }

    const route = await getRoute({
      data: {
        startLat: data.pickupLat,
        startLng: data.pickupLng,
        destLat: data.deliveryLat,
        destLng: data.deliveryLng,
      },
    });
    assertRoadDistance(route.source);
    if (!(route.distanceKm > 0) || route.distanceKm > MAX_TRANSPORT_KM) {
      throw new Error(
        "This trip is outside our service range. Please choose points closer together.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- create_transport_quote_for is newer than the generated types
    const made = await (supabaseAdmin as any).rpc("create_transport_quote_for", {
      _customer_id: userId,
      _quantity_m3: data.quantity,
      _pickup_lat: data.pickupLat,
      _pickup_lng: data.pickupLng,
      _delivery_lat: data.deliveryLat,
      _delivery_lng: data.deliveryLng,
      _road_km: route.distanceKm,
    });
    if (made.error || !made.data) {
      console.error("[transport-quote] create failed:", made.error?.message);
      throw new Error("We couldn't secure this price quote. Please try again in a moment.");
    }

    const guide = await sb.rpc("compute_transport_offer", {
      _road_km: route.distanceKm,
      _quantity_m3: data.quantity,
    });
    if (guide.error || !guide.data)
      throw new Error("We couldn't work out a price. Please try again.");
    const g = guide.data as {
      trips: number;
      perTrip: TransportOffer["perTrip"];
      total: TransportOffer["total"];
      assumptions: { note: string };
    };
    return {
      quoteId: String(made.data),
      roadKm: route.distanceKm,
      trips: g.trips,
      perTrip: g.perTrip,
      total: g.total,
      calibration: "uncalibrated",
      note: g.assumptions.note,
    };
  });
