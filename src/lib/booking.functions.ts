import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRoute } from "@/lib/routing.functions";

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
  // Client-provided distance is now only a last-resort fallback, used when
  // pickup/delivery coordinates aren't supplied. Whenever coordinates ARE
  // supplied, the server derives distance itself (see resolveDistance) —
  // the client can no longer just send a favorable distanceKm number.
  distanceKm: z.number().min(0).optional(),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  deliveryLat: z.number().optional(),
  deliveryLng: z.number().optional(),
  address: z.string().max(200).optional(),
});

function parseOfferInput(input: unknown) {
  const result = OfferInput.safeParse(input);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Invalid booking details");
  }
  return result.data;
}

type DistanceSource = "osrm" | "haversine" | "client_provided";

/**
 * The single place distance is derived for pricing. Prefers a real
 * server-side OSRM road-distance lookup (with getRoute's own haversine
 * fallback if OSRM is slow/unreachable) computed from pickup/delivery
 * coordinates; only falls back to a bare client-supplied distanceKm number
 * when no coordinates were given at all. The client never determines the
 * distance used for pricing when coordinates are available.
 */
async function resolveDistance(data: {
  distanceKm?: number;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
}): Promise<{ distanceKm: number; source: DistanceSource }> {
  if (
    data.pickupLat != null &&
    data.pickupLng != null &&
    data.deliveryLat != null &&
    data.deliveryLng != null
  ) {
    try {
      const route = await getRoute({
        data: {
          startLat: data.pickupLat,
          startLng: data.pickupLng,
          destLat: data.deliveryLat,
          destLng: data.deliveryLng,
        },
      });
      return { distanceKm: route.distanceKm, source: route.source };
    } catch {
      // getRoute already falls back to haversine internally and shouldn't
      // throw — but if it somehow does, fall through to the client-provided
      // fallback below rather than failing the whole quote.
    }
  }
  return { distanceKm: data.distanceKm ?? 15, source: "client_provided" };
}

/**
 * Persists the server-derived distance as a single-use, tamper-proof quote
 * the client can later reference (by opaque id) at job creation, so
 * tg_validate_job_budget can use the SAME distance instead of recomputing a
 * cheaper haversine straight-line figure. Never persists a bare
 * client-provided distance as "trusted" — only real osrm/haversine
 * server-side calculations from actual coordinates are eligible. Best
 * effort: a failure here must never block the customer from seeing a quote,
 * it just means that job falls back to the trigger's own haversine
 * validation (unchanged prior behaviour), so we swallow errors.
 */
async function tryCreateQuote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- create_price_quote isn't in the generated Supabase types (added via a fresh migration); matches this file's existing `as any` pattern for RPC calls.
  sb: any,
  material: string,
  quantity: number,
  distanceKm: number,
  source: DistanceSource,
): Promise<string | null> {
  if (source === "client_provided") return null;
  try {
    const { data, error } = await sb.rpc("create_price_quote", {
      _material: material,
      _quantity_m3: quantity,
      _distance_km: distanceKm,
      _distance_source: source,
    });
    if (error) return null;
    return typeof data === "string" ? data : null;
  } catch {
    return null;
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
  // figure. Null when no coordinates were supplied (falls back to the
  // trigger's own haversine calculation, same as before this change).
  quoteId: string | null;
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
  quoteId: string | null,
): OfferResult {
  const offer = Number(g.offer ?? 0);
  const min = Number(g.min ?? 0);
  const max = Number(g.max ?? 0);
  const etaMinutes = Math.max(10, Math.round((distanceKm / 40) * 60) + 20);
  const label = g.label ?? material.replace("_", " ");
  const tripCount = Number(g.tripCount ?? 1);

  return {
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
  };
}

/**
 * Fast deterministic offer. No AI in the hot path — returns immediately from the price guide.
 */
export const computeOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseOfferInput)
  .handler(async ({ data, context }): Promise<OfferResult> => {
    const { supabase } = context;
    const { distanceKm, source } = await resolveDistance(data);
    if (distanceKm > MAX_SERVICE_KM) throw new Error(TOO_FAR_MESSAGE);

    const quoteId = await tryCreateQuote(
      supabase,
      data.material,
      data.quantity,
      distanceKm,
      source,
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

    return buildOfferResult(g, data.material, data.quantity, distanceKm, quoteId);
  });

/**
 * Public, no-signup instant quote — same pricing engine as computeOffer,
 * but callable by anonymous visitors so "how much would this cost" is
 * answerable in seconds, before anyone has to create an account. Pure
 * read-only pricing lookup, so no auth is required or desired here.
 */
export const computePublicOffer = createServerFn({ method: "POST" })
  .inputValidator(parseOfferInput)
  .handler(async ({ data }): Promise<OfferResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { distanceKm, source } = await resolveDistance(data);
    if (distanceKm > MAX_SERVICE_KM) throw new Error(TOO_FAR_MESSAGE);

    // Anonymous quotes aren't tied to a customer and never feed a real job
    // insert from this page, but persisting them the same way keeps the
    // pricing path identical and costs nothing (unused quotes just expire).
    const quoteId = await tryCreateQuote(
      supabaseAdmin,
      data.material,
      data.quantity,
      distanceKm,
      source,
    );

    const { data: guide, error } = await supabaseAdmin.rpc("compute_material_offer", {
      _material: data.material,
      _quantity: data.quantity,
      _distance_km: distanceKm,
    } as any);
    if (error) throw new Error(error.message);
    const g = guide as OfferGuide;

    if (g.requiresCustomQuote) {
      throw new Error(customQuoteMessage(g, data.quantity));
    }

    return buildOfferResult(g, data.material, data.quantity, distanceKm, quoteId);
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
