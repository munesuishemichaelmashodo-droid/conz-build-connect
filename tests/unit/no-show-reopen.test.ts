import { describe, expect, it } from "vitest";
import { NO_SHOW_CANCEL_REASON, customerCanReopenNoShow } from "@/lib/cancel-policy";

const now = Date.parse("2026-11-07T12:00:00Z");
const base = {
  status: "cancelled",
  payment_method: "direct",
  cancellation_reason: NO_SHOW_CANCEL_REASON,
  cancelled_at: "2026-11-06T12:00:00Z",
};

describe("customerCanReopenNoShow (mirrors 0147)", () => {
  it("allows a recent no-show cancellation", () => {
    expect(customerCanReopenNoShow(base, now)).toBe(true);
  });
  it("not after 7 days", () => {
    expect(customerCanReopenNoShow({ ...base, cancelled_at: "2026-10-30T11:00:00Z" }, now)).toBe(
      false,
    );
  });
  it("not for escrow, other reasons, arrived or loaded jobs", () => {
    expect(customerCanReopenNoShow({ ...base, payment_method: "escrow" }, now)).toBe(false);
    expect(
      customerCanReopenNoShow({ ...base, cancellation_reason: "I changed my mind" }, now),
    ).toBe(false);
    expect(
      customerCanReopenNoShow({ ...base, driver_arrived_pickup_at: "2026-11-06T10:00:00Z" }, now),
    ).toBe(false);
    expect(customerCanReopenNoShow({ ...base, pickup_photo_url: "x" }, now)).toBe(false);
    expect(customerCanReopenNoShow({ ...base, status: "open" }, now)).toBe(false);
  });
});
