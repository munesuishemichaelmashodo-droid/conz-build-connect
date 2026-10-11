import { describe, expect, it, vi } from "vitest";

import { friendlyQuoteError, issueSourcingQuote } from "@/lib/sourcing.functions";

type Row = Record<string, unknown> | null;

function fakeAdmin(opts: {
  request?: Row;
  location?: Row;
  rpcResult?: { data: unknown; error: { message: string } | null };
}) {
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: "quote-1", error: null });
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data:
            table === "material_sourcing_requests"
              ? (opts.request ?? null)
              : (opts.location ?? null),
          error: null,
        }),
      }),
    }),
  }));
  return { rpc, from } as never as Parameters<typeof issueSourcingQuote>[0] & { rpc: typeof rpc };
}

const request = { id: "r1", delivery_lat: -18.18, delivery_lng: 31.55, status: "sourcing" };
const location = { id: "l1", lat: -20.15, lng: 28.58 };
const params = {
  requestId: "r1",
  adminId: "admin-1",
  supplyLocationId: "l1",
  validHours: 48,
  terms: "Pay on booking",
};
const okRoute = vi.fn(async () => ({ distanceKm: 312.4, source: "osrm" as const }));

describe("issueSourcingQuote", () => {
  it("computes the road distance server-side from the stored coordinates and passes the verified admin id", async () => {
    const admin = fakeAdmin({ request, location });
    const res = await issueSourcingQuote(admin, params, okRoute);

    expect(okRoute).toHaveBeenCalledWith({
      data: { startLat: -20.15, startLng: 28.58, destLat: -18.18, destLng: 31.55 },
    });
    expect(admin.rpc).toHaveBeenCalledWith("issue_sourcing_quote", {
      p_request_id: "r1",
      p_admin_id: "admin-1",
      p_supply_location_id: "l1",
      p_distance_km: 312.4,
      p_distance_source: "osrm",
      p_valid_hours: 48,
      p_terms: "Pay on booking",
      p_note: null,
    });
    expect(res).toEqual({ quoteId: "quote-1", distanceKm: 312.4 });
  });

  it("never sends a price: only ids, a server distance and terms reach the RPC", async () => {
    const admin = fakeAdmin({ request, location });
    await issueSourcingQuote(admin, params, okRoute);
    const args = (admin.rpc as unknown as { mock: { calls: [string, Record<string, unknown>][] } })
      .mock.calls[0][1];
    expect(Object.keys(args).some((k) => /price|total|amount|offer/i.test(k))).toBe(false);
  });

  it("fails closed on a routing outage (no quote, no haversine guess)", async () => {
    const admin = fakeAdmin({ request, location });
    await expect(
      issueSourcingQuote(admin, params, async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow(/routing is unavailable/i);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects a straight-line fallback distance for a payable quote", async () => {
    const admin = fakeAdmin({ request, location });
    await expect(
      issueSourcingQuote(admin, params, async () => ({ distanceKm: 250, source: "haversine" })),
    ).rejects.toThrow(/road distance could not be confirmed/i);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "rejects an invalid routed distance (%s)",
    async (d) => {
      const admin = fakeAdmin({ request, location });
      await expect(
        issueSourcingQuote(admin, params, async () => ({ distanceKm: d, source: "osrm" })),
      ).rejects.toThrow();
      expect(admin.rpc).not.toHaveBeenCalled();
    },
  );

  it("requires a delivery pin and a supply location with coordinates", async () => {
    await expect(
      issueSourcingQuote(
        fakeAdmin({ request: { ...request, delivery_lat: null }, location }),
        params,
        okRoute,
      ),
    ).rejects.toThrow(/no delivery pin/i);
    await expect(
      issueSourcingQuote(
        fakeAdmin({ request, location: { id: "l1", lat: null, lng: null } }),
        params,
        okRoute,
      ),
    ).rejects.toThrow(/no verified coordinates/i);
    await expect(
      issueSourcingQuote(fakeAdmin({ request: null, location }), params, okRoute),
    ).rejects.toThrow(/not found/i);
  });

  it("translates database refusals into safe messages", async () => {
    const reject = (message: string) =>
      fakeAdmin({ request, location, rpcResult: { data: null, error: { message } } });
    await expect(issueSourcingQuote(reject("Not authorised."), params, okRoute)).rejects.toThrow(
      /not authorised/i,
    );
    await expect(
      issueSourcingQuote(reject("invalid_supply_location"), params, okRoute),
    ).rejects.toThrow(/verified, active, exact-coordinate/i);
    await expect(
      issueSourcingQuote(
        reject("invalid_sourcing_transition: converted -> quote_ready"),
        params,
        okRoute,
      ),
    ).rejects.toThrow(/no longer be quoted/i);
  });
});

describe("friendlyQuoteError", () => {
  it("does not leak internals for unknown errors", () => {
    expect(friendlyQuoteError('relation "x" does not exist at character 14')).toBe(
      "The quote could not be issued.",
    );
  });
});
