import { describe, expect, it, vi } from "vitest";

import {
  resolveMaterialSource,
  type MaterialSourceResolution,
} from "@/lib/materialSource.functions";
import {
  AWAITING_SOURCING_MESSAGE,
  anonymousAwaitingSourcing,
  classifyResolution,
  createSourcingFallback,
  isAwaitingSourcing,
  sourcingAddress,
} from "@/lib/sourcingFallback";

const input = {
  material: "river_sand",
  quantity: 12,
  deliveryLat: -18.18,
  deliveryLng: 31.55,
  address: "Marondera CBD",
};

describe("classifyResolution: 'no supplier' vs 'we couldn't check'", () => {
  it("a configured-nothing material is no_supply", () => {
    expect(classifyResolution({ status: "no_source_configured" })).toEqual({
      kind: "no_supply",
      reason: "no_source_configured",
    });
  });

  it("configured supply with nothing eligible is no_supply", () => {
    expect(
      classifyResolution({ status: "source_resolution_failed", reason: "no_eligible_source" }),
    ).toEqual({
      kind: "no_supply",
      reason: "no_eligible_source",
    });
  });

  it.each([
    "existence_check_failed",
    "candidates_rpc_error",
    "candidates_rpc_exception",
    "all_candidate_routes_failed",
  ])("%s is an infrastructure failure, never a sourcing request", (reason) => {
    expect(classifyResolution({ status: "source_resolution_failed", reason })).toEqual({
      kind: "failure",
      reason,
    });
  });

  it("a resolved source is resolved", () => {
    const resolved = {
      status: "source_resolved",
      source: {},
    } as unknown as MaterialSourceResolution;
    expect(classifyResolution(resolved)).toEqual({ kind: "resolved" });
  });
});

describe("createSourcingFallback", () => {
  it("persists the request through the existing RPC and reports awaiting_sourcing, not a quote", async () => {
    const rpc = vi.fn(async () => ({ data: "req-123", error: null }));
    const result = await createSourcingFallback(
      { rpc },
      { ...input, idempotencyKey: "retry-key-0001" },
      "no_eligible_source",
    );

    expect(rpc).toHaveBeenCalledWith("create_material_sourcing_request", {
      p_material: "river_sand",
      p_custom_material: null,
      p_quantity_m3: 12,
      p_delivery_address: "Marondera CBD",
      p_delivery_lat: -18.18,
      p_delivery_lng: 31.55,
      p_preferred_date: null,
      p_notes: null,
      p_idempotency_key: "retry-key-0001",
    });
    expect(result).toMatchObject({
      status: "awaiting_sourcing",
      sourcingRequestId: "req-123",
      requiresSignIn: false,
      reason: "no_eligible_source",
      message: AWAITING_SOURCING_MESSAGE,
    });
    // never a price
    expect(result).not.toHaveProperty("offer");
    expect(result).not.toHaveProperty("quoteId");
    expect(isAwaitingSourcing(result)).toBe(true);
  });

  it("a retry with the same key returns the same request id (the RPC is the dedupe point)", async () => {
    const rpc = vi.fn(async () => ({ data: "req-123", error: null }));
    const a = await createSourcingFallback(
      { rpc },
      { ...input, idempotencyKey: "retry-key-0001" },
      "no_source_configured",
    );
    const b = await createSourcingFallback(
      { rpc },
      { ...input, idempotencyKey: "retry-key-0001" },
      "no_source_configured",
    );
    expect(a.sourcingRequestId).toBe(b.sourcingRequestId);
    expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
  });

  it("sends a null key when the client did not provide one (the database de-duplicates identical open requests)", async () => {
    const rpc = vi.fn(async () => ({ data: "req-1", error: null }));
    await createSourcingFallback({ rpc }, input, "no_source_configured");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_idempotency_key: null });
  });

  it("never claims 'awaiting sourcing' when the request was not stored", async () => {
    await expect(
      createSourcingFallback(
        { rpc: async () => ({ data: null, error: { message: "boom" } }) },
        input,
        "no_eligible_source",
      ),
    ).rejects.toThrow(/couldn't record your sourcing request/i);
    await expect(
      createSourcingFallback(
        { rpc: async () => ({ data: null, error: null }) },
        input,
        "no_eligible_source",
      ),
    ).rejects.toThrow(/couldn't record your sourcing request/i);
  });

  it("surfaces the rate limit and non-customer accounts clearly", async () => {
    await expect(
      createSourcingFallback(
        {
          rpc: async () => ({
            data: null,
            error: { message: "Too many sourcing requests", code: "54000" },
          }),
        },
        input,
        "no_eligible_source",
      ),
    ).rejects.toThrow(/too many open sourcing requests/i);
    await expect(
      createSourcingFallback(
        {
          rpc: async () => ({
            data: null,
            error: { message: "Only customer accounts can submit sourcing requests" },
          }),
        },
        input,
        "no_eligible_source",
      ),
    ).rejects.toThrow(/only customer accounts/i);
  });

  it("uses the pin, never an invented town, when no address text was supplied", () => {
    expect(sourcingAddress({ ...input, address: "  " })).toBe("Pin -18.18000, 31.55000");
    expect(sourcingAddress({ ...input, address: "x".repeat(900) })).toHaveLength(500);
  });
});

describe("anonymous visitors", () => {
  it("are told sourcing is needed and asked to sign in; nothing is stored and no price is shown", () => {
    const r = anonymousAwaitingSourcing(input, "no_eligible_source");
    expect(r).toMatchObject({
      status: "awaiting_sourcing",
      sourcingRequestId: null,
      requiresSignIn: true,
    });
    expect(r).not.toHaveProperty("offer");
  });
});

describe("nationwide supplier resolution (road distance decides; no default depot)", () => {
  const cand = (id: string, name: string, lat: number, lng: number) => ({
    supply_location_id: id,
    supplier_id: `s-${id}`,
    supplier_name: name,
    source_type: "quarry",
    label: name,
    address: name,
    lat,
    lng,
    priority: 100,
    haversine_km: 1,
    location_precision: "exact",
  });
  const sb = (candidates: unknown[], count = candidates.length || 1) => ({
    from: () => ({ select: () => ({ eq: async () => ({ count, error: null }) }) }),
    rpc: vi.fn(async () => ({ data: candidates, error: null })),
  });
  // distance = (rough) degrees to the customer; the real route lookup is injected
  const route = vi.fn(
    async ({
      data,
    }: {
      data: { startLat: number; startLng: number; destLat: number; destLng: number };
    }) => ({
      distanceKm: Math.hypot(data.startLat - data.destLat, data.startLng - data.destLng) * 111,
      source: "osrm" as const,
    }),
  );

  it("Bulawayo customer with a local supplier is served by the Bulawayo site, not Harare", async () => {
    const r = await resolveMaterialSource(
      sb([cand("hre", "Harare Pit", -17.83, 31.05), cand("byo", "Bulawayo Pit", -20.15, 28.58)]),
      "river_sand",
      12,
      -20.17,
      28.6,
      route,
    );
    expect(r.status).toBe("source_resolved");
    if (r.status === "source_resolved") expect(r.source.supplierName).toBe("Bulawayo Pit");
  });

  it("Bulawayo customer whose only eligible supplier is in Harare is quoted from Harare's real coordinates", async () => {
    const r = await resolveMaterialSource(
      sb([cand("hre", "Harare Pit", -17.83, 31.05)]),
      "river_sand",
      12,
      -20.17,
      28.6,
      route,
    );
    expect(r.status).toBe("source_resolved");
    if (r.status === "source_resolved") {
      expect(r.source.lat).toBe(-17.83);
      expect(r.source.distanceKm).toBeGreaterThan(300);
    }
  });

  it("outside every supplier's service area: no_eligible_source, so the caller records a sourcing request", async () => {
    const r = await resolveMaterialSource(sb([], 3), "river_sand", 12, -22.2, 30.0, route);
    expect(classifyResolution(r)).toEqual({ kind: "no_supply", reason: "no_eligible_source" });
  });

  it("routing outage is a failure, not 'no supplier' (no sourcing request, no haversine quote)", async () => {
    const down = vi.fn(async () => {
      throw new Error("osrm down");
    });
    const r = await resolveMaterialSource(
      sb([cand("hre", "Harare Pit", -17.83, 31.05)]),
      "river_sand",
      12,
      -20.17,
      28.6,
      down,
    );
    expect(classifyResolution(r)).toEqual({
      kind: "failure",
      reason: "all_candidate_routes_failed",
    });
  });
});
