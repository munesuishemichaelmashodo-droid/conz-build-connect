import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    middleware: () => ({ inputValidator: () => ({ handler: () => ({}) }) }),
    inputValidator: () => ({ handler: () => ({}) }),
  }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/routing.functions", () => ({ getRoute: vi.fn() }));
vi.mock("@/lib/materialSource.functions", () => ({ resolveMaterialSource: vi.fn() }));

import { buildOpenRequestOffer, OPEN_REQUEST_HAUL_KM } from "@/lib/booking.functions";

// Mimics compute_material_offer: grows with distance, ranges around the recommendation.
function fakeClient(opts: { custom?: boolean; error?: string } = {}) {
  return {
    rpc: vi.fn(async (_name: string, args: { _distance_km: number }) => {
      if (opts.error) return { data: null, error: { message: opts.error } };
      if (opts.custom) return { data: { enforced: false, requiresCustomQuote: true }, error: null };
      const rec = 100 + args._distance_km * 2;
      return {
        data: {
          enforced: true,
          offer: rec,
          recommended: rec,
          low: rec * 0.85,
          high: rec * 1.15,
          min: rec * 0.85,
          max: rec * 1.15,
          step: 10,
          label: "Pit sand",
          unit: "per load",
          tripCount: 2,
          referenceCapacityM3: 10,
          pricingVersion: "v1.1",
        },
        error: null,
      };
    }),
  };
}

describe("buildOpenRequestOffer", () => {
  it("returns an indicative range from short to long haul with no supplier or quote", async () => {
    const sb = fakeClient();
    const r = await buildOpenRequestOffer(sb, { material: "pit_sand", quantity: 12 });
    expect(r.openRequest).toBe(true);
    expect(r.quoteId).toBeNull();
    expect(r.resolvedSource).toBeNull();
    expect(sb.rpc).toHaveBeenCalledTimes(3);
    expect(r.min).toBeLessThan(r.max);
    expect(r.offer).toBeGreaterThanOrEqual(r.min);
    expect(r.offer).toBeLessThanOrEqual(r.max);
    expect(r.low).toBeLessThanOrEqual(r.recommended);
    expect(r.recommended).toBeLessThanOrEqual(r.high);
    expect(r.materialCost).toBe(0);
    expect(r.transportCost).toBe(0);
    expect(r.explanation).toContain(`${OPEN_REQUEST_HAUL_KM.low}–${OPEN_REQUEST_HAUL_KM.high} km`);
    expect(r.explanation).toMatch(/not confirmed/i);
  });

  it("refuses unpriced (custom) materials instead of inventing a range", async () => {
    await expect(
      buildOpenRequestOffer(fakeClient({ custom: true }), { material: "custom", quantity: 5 }),
    ).rejects.toThrow(/standard pricing/);
  });

  it("fails closed when the pricing RPC errors", async () => {
    await expect(
      buildOpenRequestOffer(fakeClient({ error: "boom" }), { material: "pit_sand", quantity: 12 }),
    ).rejects.toThrow("boom");
  });
});
