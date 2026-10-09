import { describe, expect, it, vi } from "vitest";

import { resolveMaterialSource } from "@/lib/materialSource.functions";

function mockSupabase(count: number, candidates: unknown[] = []) {
  const rpc = vi.fn(async () => ({ data: candidates, error: null }));
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({ count, error: null })),
    })),
  }));
  return { from, rpc };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    supply_location_id: "source-1",
    supplier_id: "supplier-1",
    supplier_name: "Verified Supplier",
    source_type: "quarry",
    label: "Supplier Quarry",
    address: "Verified site address",
    lat: -19.1,
    lng: 29.8,
    priority: 10,
    haversine_km: 20,
    location_precision: "exact",
    ...overrides,
  };
}

describe("resolveMaterialSource", () => {
  it("distinguishes a material with no configured supply locations", async () => {
    const sb = mockSupabase(0);

    await expect(resolveMaterialSource(sb, "river_sand", 12, -17.8, 31.0)).resolves.toEqual({
      status: "no_source_configured",
    });
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when configured supply has no eligible stocked source", async () => {
    const sb = mockSupabase(2, []);

    await expect(resolveMaterialSource(sb, "stones", 12, -17.8, 31.0)).resolves.toEqual({
      status: "source_resolution_failed",
      reason: "no_eligible_source",
    });
    expect(sb.rpc).toHaveBeenCalledWith("resolve_material_source_candidates", {
      _material: "stones",
      _quantity_m3: 12,
      _delivery_lat: -17.8,
      _delivery_lng: 31.0,
    });
  });

  it("routes from supplier coordinates and selects the closest road route", async () => {
    const farther = candidate({
      supply_location_id: "farther",
      supplier_name: "Farther",
      lat: -19.1,
    });
    const nearer = candidate({
      supply_location_id: "nearer",
      supplier_name: "Nearer",
      lat: -18.2,
      priority: 99,
    });
    const sb = mockSupabase(2, [farther, nearer]);
    const routeLookup = vi.fn(async ({ data }: { data: { startLat: number } }) => ({
      distanceKm: data.startLat === -19.1 ? 45 : 14,
      source: "osrm",
    }));

    const result = await resolveMaterialSource(sb, "stones", 12, -17.8, 31.0, routeLookup);

    expect(routeLookup).toHaveBeenCalledTimes(2);
    expect(routeLookup).toHaveBeenCalledWith({
      data: { startLat: -18.2, startLng: 29.8, destLat: -17.8, destLng: 31.0 },
    });
    expect(result).toMatchObject({
      status: "source_resolved",
      source: {
        supplyLocationId: "nearer",
        supplierName: "Nearer",
        lat: -18.2,
        lng: 29.8,
        distanceKm: 14,
      },
    });
  });

  it("rejects regional reference coordinates because they are not verified site coordinates", async () => {
    const sb = mockSupabase(1, [candidate({ location_precision: "regional" })]);
    const routeLookup = vi.fn();

    const result = await resolveMaterialSource(sb, "stones", 12, -17.8, 31.0, routeLookup);

    expect(result).toEqual({ status: "source_resolution_failed", reason: "no_eligible_source" });
    expect(routeLookup).not.toHaveBeenCalled();
  });

  it("fails closed when every eligible supplier route fails", async () => {
    const sb = mockSupabase(1, [candidate()]);
    const routeLookup = vi.fn().mockRejectedValue(new Error("route unavailable"));

    await expect(
      resolveMaterialSource(sb, "stones", 12, -17.8, 31.0, routeLookup),
    ).resolves.toEqual({
      status: "source_resolution_failed",
      reason: "all_candidate_routes_failed",
    });
  });
});
