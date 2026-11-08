import { describe, expect, it } from "vitest";
import { isTrackingToken } from "@/lib/tracking-token";

describe("isTrackingToken", () => {
  it("accepts a UUID", () => {
    expect(isTrackingToken("3d5a6977-4f1d-4f4a-8c1e-0123456789ab")).toBe(true);
    expect(isTrackingToken(" 3D5A6977-4F1D-4F4A-8C1E-0123456789AB ")).toBe(true);
  });
  it("rejects anything that cannot be a link token", () => {
    for (const t of [
      "does-not-exist",
      "",
      "3d5a6977-4f1d-4f4a-8c1e",
      "3d5a6977-4f1d-4f4a-8c1e-0123456789abz",
      null,
      undefined,
    ])
      expect(isTrackingToken(t as never)).toBe(false);
  });
});
