import { describe, expect, it } from "vitest";
import { firstRunStage } from "@/lib/first-run";

describe("firstRunStage", () => {
  const signedIn = { loading: false, userId: "u1" };

  it("waits while the account is loading", () => {
    expect(firstRunStage({ loading: true, userId: "u1", profile: null })).toBe("loading");
    expect(firstRunStage({ ...signedIn, profile: null })).toBe("loading");
  });

  it("asks for the Terms first, before any walkthrough", () => {
    expect(
      firstRunStage({
        ...signedIn,
        profile: { terms_accepted_at: null, onboarding_completed_at: null },
      }),
    ).toBe("terms");
  });

  it("shows the walkthrough once the Terms are accepted", () => {
    expect(
      firstRunStage({
        ...signedIn,
        profile: { terms_accepted_at: "2026-10-26T00:00:00Z", onboarding_completed_at: null },
      }),
    ).toBe("walkthrough");
  });

  it("is done when both are recorded", () => {
    expect(
      firstRunStage({
        ...signedIn,
        profile: {
          terms_accepted_at: "2026-10-26T00:00:00Z",
          onboarding_completed_at: "2026-10-26T00:05:00Z",
        },
      }),
    ).toBe("done");
  });

  it("never shows anything to signed-out visitors", () => {
    expect(firstRunStage({ loading: false, userId: null, profile: null })).toBe("signed_out");
  });
});
