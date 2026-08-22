import { getRoute } from "@/lib/routing.functions";

// Conservative pricing safety margin for REGIONAL sources (supplier/market
// presence confirmed, but coordinates are a best-available reference
// point rather than a verified quarry/depot gate). Applied to the real
// road distance before it's used for ranking/pricing, so a location whose
// true site might sit farther than the reference point doesn't get
// under-priced. Never applied to the service-radius eligibility check
// (that stays on the honest, unbuffered distance) and never applied to
// EXACT sources.
const REGIONAL_DISTANCE_BUFFER = 1.2;

export type ResolvedMaterialSource = {
  supplyLocationId: string;
  supplierId: string;
  supplierName: string;
  sourceType: string;
  label: string | null;
  address: string | null;
  lat: number;
  lng: number;
  distanceKm: number;
  distanceSource: "osrm" | "haversine";
  locationPrecision: "exact" | "regional";
};

type Candidate = {
  supply_location_id: string;
  supplier_id: string;
  supplier_name: string;
  source_type: string;
  label: string | null;
  address: string | null;
  lat: number;
  lng: number;
  priority: number;
  haversine_km: number;
  location_precision: "exact" | "regional";
};

/**
 * Discriminated result, so the caller can never conflate "nothing was
 * configured yet" with "something failed" -- the two must never share a
 * code path, or a real infrastructure failure would silently fall back to
 * the Harare constant, reintroducing the exact bug this feature exists to
 * fix.
 *
 * no_source_configured: this material has zero material_supply_locations
 *   rows at all. Safe to use today's existing legacy pickup fallback
 *   (materialPickups[material] ?? PICKUP_POINT) -- unchanged behavior.
 *
 * source_resolution_failed: this material HAS configured supply
 *   locations, but resolution could not produce a trustworthy answer (the
 *   eligibility RPC itself failed, or every eligible candidate's route
 *   could not be determined). The caller MUST surface a controlled error
 *   and MUST NOT fall back to Harare or any other unrelated default.
 *
 * source_resolved: a specific verified, eligible supply location was
 *   selected by real road distance (priority as a tiebreak only on an
 *   exact tie).
 */
export type MaterialSourceResolution =
  | { status: "no_source_configured" }
  | { status: "source_resolution_failed"; reason: string }
  | { status: "source_resolved"; source: ResolvedMaterialSource };

/**
 * Server-authoritative pickup-source resolution for a material order.
 *
 * Only ever called from within computeOffer/computePublicOffer's own
 * server-side handler -- never exposed as a client-callable endpoint on
 * its own, and never takes a client-supplied pickup coordinate as input.
 * The client supplies material/quantity/delivery coordinates (its own
 * order details); the server alone decides which supply location, if any,
 * fills it. A client cannot request "use this cheaper/closer pickup"
 * because there is no input path that lets it name one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- resolve_material_source_candidates isn't in the generated Supabase types (added via a fresh, unapplied migration); matches this codebase's existing `as any` pattern for RPC calls not yet reflected there.
export async function resolveMaterialSource(
  sb: any,
  material: string,
  quantityM3: number,
  deliveryLat: number,
  deliveryLng: number,
): Promise<MaterialSourceResolution> {
  // Step 0: does this material have ANY configured supply locations at
  // all, regardless of status/verification? This existence check is what
  // lets us tell "nobody has set this up yet" (safe to use the legacy
  // fallback) apart from "something is configured but not usable right
  // now" (must NOT silently fall back to Harare).
  let hasAnyConfiguredRow = false;
  try {
    const { count, error: existsError } = await sb
      .from("material_supply_locations")
      .select("id", { count: "exact", head: true })
      .eq("material", material);
    if (existsError) {
      // Can't even determine whether this material is configured -- treat
      // this as infrastructure failure, not as "nothing configured".
      return { status: "source_resolution_failed", reason: "existence_check_failed" };
    }
    hasAnyConfiguredRow = (count ?? 0) > 0;
  } catch {
    return { status: "source_resolution_failed", reason: "existence_check_failed" };
  }

  if (!hasAnyConfiguredRow) {
    return { status: "no_source_configured" };
  }

  // Step 1: eligibility filter + haversine pre-filter (tested SQL layer).
  let candidates: Candidate[];
  try {
    const { data, error } = await sb.rpc("resolve_material_source_candidates", {
      _material: material,
      _quantity_m3: quantityM3,
      _delivery_lat: deliveryLat,
      _delivery_lng: deliveryLng,
    });
    if (error) {
      return { status: "source_resolution_failed", reason: "candidates_rpc_error" };
    }
    candidates = Array.isArray(data) ? (data as Candidate[]) : [];
  } catch {
    return { status: "source_resolution_failed", reason: "candidates_rpc_exception" };
  }

  if (candidates.length === 0) {
    // Rows exist for this material, but none are currently eligible
    // (unverified, paused/closed, no coordinates, or insufficient tracked
    // quantity for this order). This must NOT fall back to the legacy
    // pickup: once Con Z has started configuring supply locations for a
    // material, silently reverting to the old materialPickups/Harare path
    // could produce an incorrect route and price. Only a true zero-rows
    // material (hasAnyConfiguredRow === false, handled above) may use the
    // legacy fallback.
    return { status: "source_resolution_failed", reason: "no_eligible_source" };
  }

  // Step 2: real road distance for each eligible candidate. A candidate
  // whose route genuinely cannot be determined is DROPPED, not silently
  // downgraded to a haversine guess that lets it keep competing -- so
  // that "all candidate routes fail" can actually surface as a real
  // failure rather than quietly succeeding on approximate distances.
  const resolved: (ResolvedMaterialSource & { priority: number })[] = [];
  for (const c of candidates) {
    try {
      const route = await getRoute({
        data: { startLat: c.lat, startLng: c.lng, destLat: deliveryLat, destLng: deliveryLng },
      });
      // Regional sources: apply the conservative pricing buffer to the
      // real road distance now, so it's the number used for BOTH ranking
      // and pricing from here on -- a single consistent "best conservative
      // estimate", not a price-only adjustment tacked on after the fact.
      const bufferedDistanceKm =
        c.location_precision === "regional" ? route.distanceKm * REGIONAL_DISTANCE_BUFFER : route.distanceKm;
      resolved.push({
        supplyLocationId: c.supply_location_id,
        supplierId: c.supplier_id,
        supplierName: c.supplier_name,
        sourceType: c.source_type,
        label: c.label,
        address: c.address,
        lat: Number(c.lat),
        lng: Number(c.lng),
        distanceKm: bufferedDistanceKm,
        distanceSource: route.source,
        locationPrecision: c.location_precision,
        priority: c.priority ?? 100,
      });
    } catch {
      // getRoute already has its own internal OSRM-with-haversine-fallback
      // and shouldn't throw except for a genuine, exceptional failure --
      // drop this one candidate and keep evaluating the rest.
    }
  }

  if (resolved.length === 0) {
    return { status: "source_resolution_failed", reason: "all_candidate_routes_failed" };
  }

  let best = resolved[0];
  for (const candidate of resolved) {
    if (
      candidate.distanceKm < best.distanceKm ||
      (candidate.distanceKm === best.distanceKm && candidate.priority < best.priority)
    ) {
      best = candidate;
    }
  }

  const { priority: _priority, ...source } = best;
  return { status: "source_resolved", source };
}
