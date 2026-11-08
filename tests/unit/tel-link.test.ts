import { describe, expect, it } from "vitest";
import { telLink } from "@/lib/tel-link";

describe("telLink", () => {
  it("makes a tap-to-dial link with the Zimbabwe country code", () => {
    expect(telLink("0771000001")).toBe("tel:+263771000001");
    expect(telLink("+263 77 100 0001")).toBe("tel:+263771000001");
    expect(telLink("00263771000001")).toBe("tel:+263771000001");
    expect(telLink("263771000001")).toBe("tel:+263771000001");
  });
  it("gives nothing for a missing or too-short number", () => {
    expect(telLink(null)).toBeNull();
    expect(telLink(undefined)).toBeNull();
    expect(telLink("")).toBeNull();
    expect(telLink("1234")).toBeNull();
  });
});
