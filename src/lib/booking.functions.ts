import { assertRoadDistance } from "@/lib/roadDistance";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRoute } from "@/lib/routing.functions";
import {
  resolveMaterialSource,
  withStockStatus,
  type ResolvedMaterialSource,
} from "@/lib/materialSource.functions";
import { classifyResolution, type AwaitingSourcingResult } from "@/lib/sourcingFallback";

export type { AwaitingSourcingResult } from "@/lib/sourcingFallback";

const MATERIALS = [
  "river_sand",
  "pit_sand",
  "quarry_dust",
  "crusher_run",
  "gravel",
  "stones",
  "top_soil",
  "filling_soil",
  "custom",
] as const;

const MAX_SERVICE_KM = 900;
const TOO_FAR_MESSAGE =
  "This delivery address is too far from our service area — please choose a closer address.";

const OfferInput = z.object({
  material: z.enum(MATERIALS),
  quantity: z.number().positive().max(50),
  // Only the customer delivery pin is accepted. Supplier pickup and route
  // distance are selected and calculated server-side.
  deliveryLat: z.number().finite().min(-23).max(-15),
  deliveryLng: z.number().finite().min(25).max(33.5),
  address: z.string().max(200).optional(),
  // Optional client-generated key so a retried "no supplier" submit maps to
  // the same sourcing request (the database also de-duplicates identical open
  // requests when no key is sent).
  idempotencyKey: z.string().min(8).max(128).optional(),
});

function parseOfferInput(input: unknown) {
  const result = OfferInput.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid booking details");
  }
  return result.data;
}

type DistanceSource = "osrm" | "haversine";

/**
 * Server-authoritative supplier selection and route distance. Missing or
 * unusable verified supply fails closed; no client or city-origin fallback
 * can influence a quote.
 */
async function resolvePickupAndDistance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resolve_material_source_candidates isn't in the generated Supabase types (added via a fresh, unapplied migration); matches this file's existing `as any` pattern for RPC calls.
  sb: any,
  data: {
    material: string;
    quantity: number;
    deliveryLat: number;
    deliveryLng: number;
  },
): Promise<
  | {
      kind: "resolved";
      distanceKm: number;
      source: DistanceSource;
      resolvedSource: ResolvedMaterialSource;
    }
  | { kind: "open_request" }
> {
  const resolution = await resolveMaterialSource(
    sb,
    data.material,
    data.quantity,
    data.deliveryLat,
    data.deliveryLng,
  );

  const outcome = classifyResolution(resolution);
  if (outcome.kind === "resolved" && resolution.status === "source_resolved") {
    // Never price from a straight-line fallback: fail closed and let the customer retry.
    assertRoadDistance(resolution.source.distanceSource);
    return {
      kind: "resolved",
      distanceKm: resolution.source.distanceKm,
      source: resolution.source.distanceSource,
      resolvedSource: resolution.source,
    };
  }
  // No ConZ supplier exists for this material, or none covers this delivery
  // point. That is NOT an error: the customer can post an open request and
  // drivers bid their own price (see buildOpenRequestOffer). Owner decision
  // 14/10/2026: open requests, not ConZ-run sourcing requests.
  if (outcome.kind === "no_supply") return { kind: "open_request" };
  // We could not determine availability (infrastructure / routing). Retryable
  // error -- must NOT be reported to the customer as "no supplier".
  throw new Error("Unable to determine a verified material pickup location. Please try again.");
}

/**
 * Persists the server-derived distance as a single-use, tamper-proof quote
 * the client can later reference (by opaque id) at job creation, so
 * tg_validate_job_budget can use the SAME distance instead of recomputing a
 * cheaper haversine straight-line figure. Quote persistence is required: a
 * price without a bound verified supplier and route must not be displayed.
 */
async function tryCreateQuote(
  customerId: string | null,
  material: string,
  quantity: number,
  distanceKm: number,
  source: DistanceSource,
  supplyLocationId: string,
): Promise<string> {
  // Quotes are created only by the server (service role), bound to the
  // customer and the server-resolved supply location (0080). The previous
  // client-side call hit an ambiguous overload and always failed silently.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- create_price_quote_for isn't in the generated Supabase types yet.
    const { data, error } = await (supabaseAdmin as any).rpc("create_price_quote_for", {
      _customer_id: customerId,
      _material: material,
      _quantity_m3: quantity,
      _distance_km: distanceKm,
      _distance_source: source,
      _supply_location_id: supplyLocationId,
    });
    if (error) {
      console.error("[quote] create_price_quote_for failed:", error.message);
      throw new Error("We couldn't secure this price quote. Please try again in a moment.");
    }
    if (typeof data === "string") return data;
    throw new Error("We couldn't secure this price quote. Please try again in a moment.");
  } catch (err) {
    console.error("[quote] create_price_quote_for threw:", err);
    throw new Error("We couldn't secure this price quote. Please try again in a moment.");
  }
}

function customQuoteMessage(
  g: { enforced: boolean; requiresCustomQuote?: boolean; error?: string },
  quantity: number,
): string {
  if (g.error === "invalid_quantity") {
    return `${quantity} m³ isn't a valid quantity — please enter a positive amount.`;
  }
  if (g.error === "invalid_distance") {
    return `We couldn't work out a valid distance for this delivery — please check the address and try again.`;
  }
  if (g.enforced === false) {
    return `We don't have standard pricing for this material yet — please contact support for a custom quote.`;
  }
  if (quantity < 1) {
    return `${quantity} m³ isn't available for this material yet — please contact support for a custom quote, or increase the quantity.`;
  }
  // Above ~20 m3, pricing now uses trip-aware reference pricing directly
  // (see compute_material_offer Mode C) — this message is now a rare
  // fallback, not the normal path for large orders.
  return `We couldn't calculate a price for ${quantity} m³ of this material — please contact support for a custom quote.`;
}

export type OfferResult = {
  status: "offer";
  offer: number;
  min: number;
  max: number;
  low: number;
  recommended: number;
  high: number;
  step: number;
  label: string;
  unit: string;
  enforced: boolean;
  etaMinutes: number;
  distanceKm: number;
  explanation: string;
  materialCost: number;
  transportCost: number;
  tripCount: number;
  referenceCapacityM3: number;
  pricingVersion: string;
  // Opaque reference to a server-computed, tamper-proof distance snapshot.
  // Pass this back at job creation (jobs.quote_id) so the DB trigger uses
  // the same road distance instead of recomputing a cheaper haversine
  // figure. A quote is mandatory for a displayed price.
  quoteId: string | null;
  // True when no ConZ supplier covers this order: the job is posted as an open
  // request (driver arranges pickup, driver bids their own price). The price
  // shown is then an indicative range, not a supplier-backed quote.
  openRequest: boolean;
  // Server-resolved material supply source, for transparency display only
  // ("picked up from Pomona Stone Quarries") — the client never supplies
  // or influences this; it's purely informational, mirroring how
  // pricingVersion/tripCount are shown without being client-editable. Always
  // present because a quote requires an eligible verified supply location.
  resolvedSource: ResolvedMaterialSource | null;
};

type OfferGuide = {
  offer: number | null;
  min: number | null;
  max: number | null;
  low?: number | null;
  recommended?: number | null;
  high?: number | null;
  step: number;
  label?: string;
  unit?: string;
  enforced: boolean;
  materialCost?: number;
  transportCost?: number;
  requiresCustomQuote?: boolean;
  error?: string;
  tripCount?: number;
  referenceCapacityM3?: number;
  pricingVersion?: string;
};

function buildOfferResult(
  g: OfferGuide,
  material: string,
  quantity: number,
  distanceKm: number,
  quoteId: string,
  resolvedSource: ResolvedMaterialSource,
): OfferResult {
  const offer = Number(g.offer ?? 0);
  const min = Number(g.min ?? 0);
  const max = Number(g.max ?? 0);
  const etaMinutes = Math.max(10, Math.round((distanceKm / 40) * 60) + 20);
  const label = g.label ?? material.replace("_", " ");
  const tripCount = Number(g.tripCount ?? 1);

  return {
    status: "offer",
    offer,
    min,
    max,
    low: Number(g.low ?? min),
    recommended: Number(g.recommended ?? offer),
    high: Number(g.high ?? max),
    step: Number(g.step ?? 5),
    label,
    unit: g.unit ?? "10-15 m³ load",
    enforced: Boolean(g.enforced),
    etaMinutes,
    distanceKm: Math.round(distanceKm),
    explanation:
      tripCount > 1
        ? `Fair rate for ${label} — ${quantity} m³, ${Math.round(distanceKm)} km, ~${tripCount} trips.`
        : `Fair rate for ${label} — ${quantity} m³, ${Math.round(distanceKm)} km.`,
    materialCost: Number(g.materialCost ?? 0),
    transportCost: Number(g.transportCost ?? 0),
    tripCount,
    referenceCapacityM3: Number(g.referenceCapacityM3 ?? 10),
    pricingVersion: g.pricingVersion ?? "v1.1",
    quoteId,
    openRequest: false,
    resolvedSource,
  };
}

/**
 * Assumed one-way haul distances (pickup -> delivery) used ONLY to show an
 * indicative guide range for an open request, where nobody has chosen a
 * supplier yet. The real distance depends on where the driver collects.
 * Owner-adjustable constants; not used for any supplier-backed quote.
 */
export const OPEN_REQUEST_HAUL_KM = { low: 10, typical: 40, high: 120 } as const;

/**
 * Open request: no ConZ supplier covers this order. Drivers already know where
 * to collect, so we show an honest indicative range (reference price at a
 * short, typical and long haul) and the driver bids their own amount.
 * Nothing here claims stock or a fixed supplier.
 */
export async function buildOpenRequestOffer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same untyped RPC client pattern as the rest of this file.
  sb: any,
  data: { material: string; quantity: number },
): Promise<OfferResult> {
  const at = async (km: number): Promise<OfferGuide> => {
    const { data: guide, error } = await sb.rpc("compute_material_offer", {
      _material: data.material,
      _quantity: data.quantity,
      _distance_km: km,
    });
    if (error) throw new Error(error.message);
    const g = guide as OfferGuide;
    if (g.requiresCustomQuote || g.enforced === false) {
      throw new Error(customQuoteMessage(g, data.quantity));
    }
    return g;
  };
  const [lo, mid, hi] = await Promise.all([
    at(OPEN_REQUEST_HAUL_KM.low),
    at(OPEN_REQUEST_HAUL_KM.typical),
    at(OPEN_REQUEST_HAUL_KM.high),
  ]);
  const min = Number(lo.min ?? 0);
  const max = Number(hi.max ?? 0);
  if (!(min > 0) || !(max >= min)) {
    throw new Error(
      customQuoteMessage({ enforced: true, requiresCustomQuote: true }, data.quantity),
    );
  }
  const label = mid.label ?? data.material.replace("_", " ");
  const tripCount = Number(mid.tripCount ?? 1);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const typical = clamp(Number(mid.recommended ?? mid.offer ?? min));
  return {
    status: "offer",
    offer: typical,
    min,
    max,
    low: clamp(Number(lo.recommended ?? min)),
    recommended: typical,
    high: clamp(Number(hi.recommended ?? max)),
    step: Number(mid.step ?? 10),
    label,
    unit: mid.unit ?? "per load",
    enforced: true,
    etaMinutes: Math.max(10, Math.round((OPEN_REQUEST_HAUL_KM.typical / 40) * 60) + 20),
    distanceKm: OPEN_REQUEST_HAUL_KM.typical,
    explanation:
      `Open request for ${label} — ${data.quantity} m³. No ConZ supplier covers this, so a driver arranges the pickup ` +
      `and bids their own price. This is an indicative range for hauls of ${OPEN_REQUEST_HAUL_KM.low}–${OPEN_REQUEST_HAUL_KM.high} km; ` +
      `availability is not confirmed until a driver accepts.`,
    materialCost: 0,
    transportCost: 0,
    tripCount,
    referenceCapacityM3: Number(mid.referenceCapacityM3 ?? 10),
    pricingVersion: mid.pricingVersion ?? "v1.1",
    quoteId: null,
    openRequest: true,
    resolvedSource: null,
  };
}

/**
 * Fast deterministic offer. No AI in the hot path — returns immediately from the price guide.
 */
export const computeOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseOfferInput)
  .handler(async ({ data, context }): Promise<OfferResult | AwaitingSourcingResult> => {
    const { supabase } = context;
    const picked = await resolvePickupAndDistance(supabase, data);
    if (picked.kind === "open_request") return buildOpenRequestOffer(supabase, data);
    const { distanceKm, source, resolvedSource } = picked;
    if (distanceKm > MAX_SERVICE_KM) throw new Error(TOO_FAR_MESSAGE);

    const quoteId = await tryCreateQuote(
      context.userId,
      data.material,
      data.quantity,
      distanceKm,
      source,
      resolvedSource.supplyLocationId,
    );

    const { data: guide, error } = await supabase.rpc("compute_material_offer", {
      _material: data.material,
      _quantity: data.quantity,
      _distance_km: distanceKm,
    });
    if (error) throw new Error(error.message);
    const g = guide as OfferGuide;

    if (g.requiresCustomQuote) {
      throw new Error(customQuoteMessage(g, data.quantity));
    }

    return buildOfferResult(
      g,
      data.material,
      data.quantity,
      distanceKm,
      quoteId,
      await withStockStatus(supabase, resolvedSource, data.quantity),
    );
  });

/**
 * Public, no-signup instant quote — same pricing engine as computeOffer,
 * but callable by anonymous visitors so "how much would this cost" is
 * answerable in seconds, before anyone has to create an account. Pure
 * read-only pricing lookup, so no auth is required or desired here.
 */
export const computePublicOffer = createServerFn({ method: "POST" })
  .inputValidator(parseOfferInput)
  .handler(async ({ data }): Promise<OfferResult | AwaitingSourcingResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const picked = await resolvePickupAndDistance(supabaseAdmin, data);
    if (picked.kind === "open_request") {
      throw new Error(
        "We have no listed supplier for this material near you. Sign in and book it as an open request — drivers bid their own price.",
      );
    }
    const { distanceKm, source, resolvedSource } = picked;
    if (distanceKm > MAX_SERVICE_KM) throw new Error(TOO_FAR_MESSAGE);

    // Anonymous quotes aren't tied to a customer and never feed a real job
    // insert from this page, but persisting them the same way keeps the
    // pricing path identical and costs nothing (unused quotes just expire).
    const quoteId = await tryCreateQuote(
      null,
      data.material,
      data.quantity,
      distanceKm,
      source,
      resolvedSource.supplyLocationId,
    );

    const { data: guide, error } = await supabaseAdmin.rpc("compute_material_offer", {
      _material: data.material,
      _quantity: data.quantity,
      _distance_km: distanceKm,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing: material enum typing for the public quote RPC
    } as any);
    if (error) throw new Error(error.message);
    const g = guide as OfferGuide;

    if (g.requiresCustomQuote) {
      throw new Error(customQuoteMessage(g, data.quantity));
    }

    return buildOfferResult(
      g,
      data.material,
      data.quantity,
      distanceKm,
      quoteId,
      await withStockStatus(supabaseAdmin, resolvedSource, data.quantity),
    );
  });

const SourcingOfferInput = z.object({ requestId: z.string().uuid() });

export type SourcingOfferResult = OfferResult & {
  sourcingRequestId: string;
  material: string;
  quantity: number;
  validUntil: string;
  terms: string | null;
  delivery: { address: string; lat: number; lng: number };
};

/**
 * Turns an admin-issued, engine-priced sourcing quote back into the same
 * OfferResult the normal booking flow consumes, so the customer books it
 * through the existing job/payment path. Nothing here is client-trusted: the
 * request is read through the customer's own RLS, and the quote, supply
 * location and price are re-read and re-validated server-side. Booking is
 * still the customer's explicit action -- this never creates a job.
 */
export const getSourcingOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SourcingOfferInput.parse(input))
  .handler(async ({ data, context }): Promise<SourcingOfferResult> => {
    const { supabase, userId } = context;
    /* eslint-disable @typescript-eslint/no-explicit-any -- sourcing tables/columns are not in the generated Supabase types yet (0087/0088 unapplied). */
    const { data: req, error } = await (supabase as any)
      .from("material_sourcing_requests")
      .select(
        "id, customer_id, material, quantity_m3, status, quote_id, quote_valid_until, terms, delivery_address, delivery_lat, delivery_lng, supply_location_id",
      )
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req || req.customer_id !== userId) throw new Error("Sourcing request not found.");
    if (
      req.status !== "quote_ready" ||
      !req.quote_id ||
      !req.supply_location_id ||
      !req.quote_valid_until
    ) {
      throw new Error("This sourcing request doesn't have an active quote.");
    }
    if (new Date(req.quote_valid_until).getTime() <= Date.now()) {
      throw new Error("This quote has expired. Please request sourcing again.");
    }
    if (req.delivery_lat == null || req.delivery_lng == null) {
      throw new Error("This request has no delivery pin, so it can't be booked.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: quote } = await admin
      .from("price_quotes")
      .select(
        "id, customer_id, distance_km, distance_source, expires_at, consumed_at, supply_location_id",
      )
      .eq("id", req.quote_id)
      .maybeSingle();
    if (
      !quote ||
      quote.customer_id !== userId ||
      quote.consumed_at ||
      quote.supply_location_id !== req.supply_location_id ||
      new Date(quote.expires_at).getTime() <= Date.now() ||
      quote.distance_source !== "osrm"
    ) {
      throw new Error("This quote is no longer valid. Please request sourcing again.");
    }
    const { data: loc } = await admin
      .from("material_supply_locations")
      .select("id, supplier_id, source_type, label, address, lat, lng, suppliers(name)")
      .eq("id", req.supply_location_id)
      .maybeSingle();
    if (!loc || loc.lat == null || loc.lng == null) {
      throw new Error("The supplier location for this quote is no longer available.");
    }

    const { data: guide, error: guideErr } = await admin.rpc("compute_material_offer", {
      _material: req.material,
      _quantity: Number(req.quantity_m3),
      _distance_km: Number(quote.distance_km),
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (guideErr) throw new Error(guideErr.message);
    const g = guide as OfferGuide;
    if (g.requiresCustomQuote) throw new Error(customQuoteMessage(g, Number(req.quantity_m3)));

    const resolvedSource: ResolvedMaterialSource = {
      supplyLocationId: loc.id,
      supplierId: loc.supplier_id,
      supplierName: loc.suppliers?.name ?? "Verified supplier",
      sourceType: loc.source_type,
      label: loc.label ?? null,
      address: loc.address ?? null,
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      distanceKm: Number(quote.distance_km),
      distanceSource: quote.distance_source,
      locationPrecision: "exact",
    };
    const offer = buildOfferResult(
      g,
      req.material,
      Number(req.quantity_m3),
      Number(quote.distance_km),
      req.quote_id,
      await withStockStatus(admin, resolvedSource, Number(req.quantity_m3)),
    );
    return {
      ...offer,
      sourcingRequestId: req.id,
      material: req.material,
      quantity: Number(req.quantity_m3),
      validUntil: req.quote_valid_until,
      terms: req.terms ?? null,
      delivery: {
        address: req.delivery_address,
        lat: Number(req.delivery_lat),
        lng: Number(req.delivery_lng),
      },
    };
  });

const ExplainInput = z.object({
  material: z.string().max(50),
  quantity: z.number().positive().max(50),
  // Clamp instead of hard-max so the AI blurb never becomes the source of a
  // raw Zod error surfaced to the customer.
  distanceKm: z
    .number()
    .min(0)
    .transform((v) => Math.min(v, MAX_SERVICE_KM)),
});

/**
 * Best-effort AI explanation. Called in the background after the offer is shown.
 */
export const explainOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExplainInput.parse(input))
  .handler(async ({ data }): Promise<{ explanation: string }> => {
    const fallback = `Fair rate for ${data.material.replace("_", " ")} — ${data.quantity} m³, ${Math.round(data.distanceKm)} km.`;
    try {
      const key = process.env.LOVABLE_API_KEY;
      if (!key) return { explanation: fallback };
      const { generateText } = await import("ai");
      const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
      const gateway = createLovableAiGatewayProvider(key);
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        prompt:
          `Write ONE friendly sentence (max 18 words) explaining a fair transport offer to a construction customer in Zimbabwe. ` +
          `Do NOT mention any price number, ranges, minimums, maximums, formulas, or dollar figures. ` +
          `Only reference material, quantity, and distance qualitatively. ` +
          `Material: ${data.material}. Quantity: ${data.quantity} m³. Distance: ~${Math.round(data.distanceKm)} km. ` +
          `Return plain text, no quotes.`,
      });
      const clean = text?.trim().replace(/^["']|["']$/g, "");
      return { explanation: clean || fallback };
    } catch {
      return { explanation: fallback };
    }
  });
