import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRoute } from "@/lib/routing.functions";

type RouteLookup = (args: {
  data: { startLat: number; startLng: number; destLat: number; destLng: number };
}) => Promise<{ distanceKm: number; source: "osrm" | "haversine" }>;

type Rpc = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        v: string,
      ) => {
        maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
      };
    };
  };
};

export type IssueQuoteParams = {
  requestId: string;
  adminId: string; // verified JWT subject, never client supplied
  supplyLocationId: string;
  validHours: number;
  terms: string;
  note?: string;
};

/**
 * Issue a sourcing quote.
 *
 * Authorization is enforced in the database: issue_sourcing_quote() verifies
 * that `adminId` holds an admin role. The road distance is computed here,
 * server-side, from the supply location's stored coordinates to the
 * request's stored delivery pin -- the admin supplies neither a distance nor
 * a price. A straight-line fallback is NOT accepted for a quote that becomes
 * a payable offer: if routing is unavailable the call fails and can be
 * retried.
 */
export async function issueSourcingQuote(
  admin: Rpc,
  params: IssueQuoteParams,
  routeLookup: RouteLookup = getRoute,
): Promise<{ quoteId: string; distanceKm: number }> {
  const { data: req } = await admin
    .from("material_sourcing_requests")
    .select("id, delivery_lat, delivery_lng, status")
    .eq("id", params.requestId)
    .maybeSingle();
  if (!req) throw new Error("Sourcing request not found.");
  if (req.delivery_lat == null || req.delivery_lng == null) {
    throw new Error("This request has no delivery pin, so a road distance can't be calculated.");
  }

  const { data: loc } = await admin
    .from("material_supply_locations")
    .select("id, lat, lng")
    .eq("id", params.supplyLocationId)
    .maybeSingle();
  if (!loc || loc.lat == null || loc.lng == null) {
    throw new Error("That supply location has no verified coordinates.");
  }

  let route: { distanceKm: number; source: "osrm" | "haversine" };
  try {
    route = await routeLookup({
      data: {
        startLat: Number(loc.lat),
        startLng: Number(loc.lng),
        destLat: Number(req.delivery_lat),
        destLng: Number(req.delivery_lng),
      },
    });
  } catch {
    throw new Error("Road routing is unavailable right now. Please try again in a moment.");
  }
  if (route.source !== "osrm" || !Number.isFinite(route.distanceKm) || route.distanceKm < 0) {
    throw new Error(
      "A road distance could not be confirmed, so no quote was issued. Please try again.",
    );
  }

  const { data, error } = await admin.rpc("issue_sourcing_quote", {
    p_request_id: params.requestId,
    p_admin_id: params.adminId,
    p_supply_location_id: params.supplyLocationId,
    p_distance_km: route.distanceKm,
    p_distance_source: route.source,
    p_valid_hours: params.validHours,
    p_terms: params.terms,
    p_note: params.note ?? null,
  });
  if (error) throw new Error(friendlyQuoteError(error.message));
  if (typeof data !== "string") throw new Error("The quote could not be issued.");
  return { quoteId: data, distanceKm: route.distanceKm };
}

export function friendlyQuoteError(message: string): string {
  if (/Not authorised/i.test(message)) return "You are not authorised to issue sourcing quotes.";
  if (/invalid_supply_location/.test(message)) {
    return "That supply location isn't eligible: it must be verified, active, exact-coordinate, belong to a verified supplier and have enough tracked stock.";
  }
  if (/terms_required/.test(message)) return "Add the quote terms before issuing.";
  if (/custom_material_requires_manual_quote/.test(message)) {
    return "Custom materials have no engine price and need a manual quote outside this tool.";
  }
  if (/no_engine_price_available/.test(message))
    return "The pricing engine can't price this order.";
  if (/invalid_sourcing_transition/.test(message))
    return "This request can no longer be quoted (it is closed or already quoted).";
  if (/delivery_coordinates_required/.test(message)) return "This request has no delivery pin.";
  return "The quote could not be issued.";
}

const IssueInput = z.object({
  requestId: z.string().uuid(),
  supplyLocationId: z.string().uuid(),
  validHours: z.number().int().min(1).max(168).default(48),
  terms: z.string().trim().min(3).max(1000),
  note: z.string().trim().max(500).optional(),
});

export const adminIssueSourcingQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IssueInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return issueSourcingQuote(supabaseAdmin as never, {
      requestId: data.requestId,
      adminId: context.userId,
      supplyLocationId: data.supplyLocationId,
      validHours: data.validHours,
      terms: data.terms,
      note: data.note,
    });
  });
