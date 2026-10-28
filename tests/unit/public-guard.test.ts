import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter, inServiceArea } from "@/lib/public-guard";

describe("public endpoint guard", () => {
  it("accepts Zimbabwe (and border towns), refuses elsewhere", () => {
    expect(inServiceArea(-17.83, 31.05)).toBe(true); // Harare
    expect(inServiceArea(-20.15, 28.58)).toBe(true); // Bulawayo
    expect(inServiceArea(-17.93, 25.85)).toBe(true); // Victoria Falls
    expect(inServiceArea(-22.22, 30.0)).toBe(true); // Beitbridge
    expect(inServiceArea(-26.2, 28.04)).toBe(false); // Johannesburg
    expect(inServiceArea(51.5, -0.12)).toBe(false); // London
    expect(inServiceArea(Number.NaN, 31)).toBe(false);
  });

  it("limits each visitor per window and resets after it", () => {
    const allow = createRateLimiter(3, 60_000);
    const t = 1_000;
    expect([allow("a", t), allow("a", t), allow("a", t), allow("a", t)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(allow("b", t)).toBe(true);
    expect(allow("a", t + 60_000)).toBe(true);
  });

  it("uses the first forwarded address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});
