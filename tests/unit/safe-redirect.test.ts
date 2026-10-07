import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/safe-redirect";

describe("safeInternalPath (audit F8 open redirect)", () => {
  it("keeps normal in-app paths", () => {
    expect(safeInternalPath("/admin")).toBe("/admin");
    expect(safeInternalPath("/jobs/123?tab=chat#top")).toBe("/jobs/123?tab=chat#top");
    // Percent-encoded characters stay inside our own path.
    expect(safeInternalPath("/%0aevil")).toBe("/%0aevil");
  });

  it.each([
    "/\\evil.com", // the audited bypass: browsers treat "/\" as "//"
    "\\\\evil.com",
    "//evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/\tevil.com",
    "/\nevil.com",
    "",
  ])("rejects %j", (input) => {
    expect(safeInternalPath(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(safeInternalPath(null)).toBeNull();
    expect(safeInternalPath(undefined)).toBeNull();
  });
});
