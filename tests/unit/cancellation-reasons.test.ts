import { describe, expect, it } from "vitest";
import { cancellationReasonLabel, cancellationReasonOptions } from "@/lib/cancellation-reasons";

describe("cancellationReasonOptions", () => {
  it("shows a customer every category", () => {
    const codes = cancellationReasonOptions("customer").map((o) => o.value);
    expect(codes).toContain("price_too_high");
    expect(codes).toContain("no_driver_responded");
    expect(codes).toContain("other");
    expect(new Set(codes).size).toBe(9);
  });
  it("shows a driver only reasons that apply to a driver", () => {
    const codes = cancellationReasonOptions("driver").map((o) => o.value);
    expect(codes).toEqual(["material_unavailable", "delivery_details_changed", "other"]);
    expect(codes).not.toContain("price_too_high");
  });
  it("never offers a driver the system no-show category", () => {
    for (const role of ["customer", "driver", "admin"] as const) {
      expect(cancellationReasonOptions(role).length).toBeGreaterThan(0);
    }
    expect(cancellationReasonOptions("driver").map((o) => o.value)).not.toContain(
      "driver_did_not_arrive",
    );
  });
});

describe("cancellationReasonLabel", () => {
  it("labels known categories in plain words", () => {
    expect(cancellationReasonLabel("driver_did_not_arrive")).toBe("The driver did not arrive");
  });
  it("shows old or missing reasons as unknown, never guesses", () => {
    expect(cancellationReasonLabel(null)).toBe("Unknown / not provided");
    expect(cancellationReasonLabel(undefined)).toBe("Unknown / not provided");
    expect(cancellationReasonLabel("something_old")).toBe("Unknown / not provided");
  });
});
