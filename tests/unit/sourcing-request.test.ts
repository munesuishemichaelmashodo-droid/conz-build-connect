import { describe, expect, it, vi } from "vitest";
import {
  MAX_SOURCING_NOTE,
  parseSourcingRequestInput,
  sourcingQuoteProblem,
  sourcingRequestProblem,
  sourcingRequestsEnabledFrom,
} from "@/lib/sourcing-request";
import { createSourcingFallback } from "@/lib/sourcingFallback";
import { stockStatusCopy } from "@/lib/stockStatus";

const ok = {
  material: "river_sand",
  quantity: 12,
  deliveryLat: -17.8,
  deliveryLng: 31.05,
  address: "Avondale, Harare",
  idempotencyKey: "req-12345678",
};

describe("quotation request: switch", () => {
  it("is off unless the setting is exactly true", () => {
    expect(sourcingRequestsEnabledFrom(undefined)).toBe(false);
    expect(sourcingRequestsEnabledFrom(null)).toBe(false);
    expect(sourcingRequestsEnabledFrom("true")).toBe(false);
    expect(sourcingRequestsEnabledFrom(1)).toBe(false);
    expect(sourcingRequestsEnabledFrom(true)).toBe(true);
  });
});

describe("quotation request: input validation", () => {
  it("accepts a normal request and trims the note", () => {
    expect(parseSourcingRequestInput({ ...ok, notes: "  morning only  " }).notes).toBe(
      "morning only",
    );
  });
  it("refuses 'custom' (no material name is collected), zero or huge quantities", () => {
    expect(() => parseSourcingRequestInput({ ...ok, material: "custom" })).toThrow();
    expect(() => parseSourcingRequestInput({ ...ok, quantity: 0 })).toThrow("Enter a quantity");
    expect(() => parseSourcingRequestInput({ ...ok, quantity: 51 })).toThrow("50 m³");
  });
  it("refuses points outside Zimbabwe and a missing idempotency key", () => {
    expect(() => parseSourcingRequestInput({ ...ok, deliveryLat: -30 })).toThrow();
    expect(() => parseSourcingRequestInput({ ...ok, idempotencyKey: undefined })).toThrow();
  });
  it("refuses a past date and an over-long note", () => {
    expect(() => parseSourcingRequestInput({ ...ok, preferredDate: "2020-01-01" })).toThrow(
      "later date",
    );
    expect(() =>
      parseSourcingRequestInput({ ...ok, notes: "x".repeat(MAX_SOURCING_NOTE + 1) }),
    ).toThrow();
  });
});

describe("quotation request: stored through the existing RPC", () => {
  it("passes the date and note, and reports awaiting_sourcing with no price", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "req-id-1", error: null });
    const r = await createSourcingFallback(
      { rpc },
      { ...ok, preferredDate: "2099-01-01", notes: "Gate code 12" },
      "no_eligible_source",
    );
    expect(rpc).toHaveBeenCalledWith(
      "create_material_sourcing_request",
      expect.objectContaining({ p_preferred_date: "2099-01-01", p_notes: "Gate code 12" }),
    );
    expect(r.status).toBe("awaiting_sourcing");
    expect(JSON.stringify(r)).not.toMatch(/price|total|\$/i);
  });
  it("blank notes are sent as null", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "req-id-2", error: null });
    await createSourcingFallback({ rpc }, { ...ok, notes: "   " }, "no_source_configured");
    expect(rpc.mock.calls[0][1].p_notes).toBeNull();
  });
});

describe("sourcing quote: expiry and validity", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const req = {
    customer_id: "u1",
    status: "quote_ready",
    quote_id: "q1",
    supply_location_id: "s1",
    quote_valid_until: "2026-10-26T13:00:00Z",
    delivery_lat: -17.8,
    delivery_lng: 31.0,
  };
  const quote = {
    customer_id: "u1",
    consumed_at: null,
    supply_location_id: "s1",
    expires_at: "2026-10-26T13:00:00Z",
    distance_source: "osrm",
  };
  it("a live quote for the right customer is bookable", () => {
    expect(sourcingRequestProblem(req, "u1", now)).toBeNull();
    expect(sourcingQuoteProblem(quote, req, "u1", now)).toBeNull();
  });
  it("an expired request quote says so", () => {
    expect(
      sourcingRequestProblem({ ...req, quote_valid_until: "2026-10-26T12:00:00Z" }, "u1", now),
    ).toMatch(/expired/);
  });
  it("someone else's request reads as not found", () => {
    expect(sourcingRequestProblem(req, "u2", now)).toBe("Sourcing request not found.");
    expect(sourcingRequestProblem(null, "u1", now)).toBe("Sourcing request not found.");
  });
  it("no quote yet, or no delivery pin, can't be booked", () => {
    expect(sourcingRequestProblem({ ...req, status: "sourcing" }, "u1", now)).toMatch(
      /active quote/,
    );
    expect(sourcingRequestProblem({ ...req, delivery_lat: null }, "u1", now)).toMatch(/pin/);
  });
  it("an expired, used, re-pointed or straight-line price quote is refused", () => {
    for (const bad of [
      { ...quote, expires_at: "2026-10-26T11:59:59Z" },
      { ...quote, consumed_at: "2026-10-26T11:00:00Z" },
      { ...quote, supply_location_id: "s2" },
      { ...quote, distance_source: "haversine" },
      { ...quote, customer_id: "u2" },
    ]) {
      expect(sourcingQuoteProblem(bad, req, "u1", now)).toMatch(/no longer valid/);
    }
    expect(sourcingQuoteProblem(null, req, "u1", now)).toMatch(/no longer valid/);
  });
});

describe("unknown stock wording", () => {
  it("calls the price an estimate and never claims it is real or confirmed", () => {
    const c = stockStatusCopy({ status: "unknown" } as never);
    const text = JSON.stringify(c);
    expect(text).toMatch(/estimate/);
    expect(text).not.toMatch(/price and route are real/i);
    expect(text).not.toMatch(/in stock|available now/i);
  });
});
