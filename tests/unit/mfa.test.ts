import { describe, expect, it } from "vitest";
import {
  isMfaRequiredError,
  isSecondApprovalError,
  readableRpcError,
  authenticatorHref,
  hasVerifiedAuthenticator,
  mfaVerifyHref,
  STEP_UP_ACTION_LABEL,
} from "@/lib/mfa";

// The database decides whether a sensitive admin action may proceed (require_aal2).
// These tests cover only how the screen tells the admin that extra authentication is needed.
describe("admin step-up messaging", () => {
  it("recognises the database's MFA_REQUIRED errors, missing and expired alike", () => {
    expect(
      isMfaRequiredError({
        message: "MFA_REQUIRED: verify with your authenticator app to perform this action.",
      }),
    ).toBe(true);
    expect(
      isMfaRequiredError({
        message:
          "MFA_REQUIRED: your verification has expired. Verify again with your authenticator app to continue.",
      }),
    ).toBe(true);
  });
  it("does not treat ordinary failures as step-up prompts", () => {
    expect(isMfaRequiredError({ message: "Forbidden" })).toBe(false);
    expect(isMfaRequiredError(null)).toBe(false);
    expect(
      isSecondApprovalError({ message: "SECOND_APPROVAL_REQUIRED: ask another super admin" }),
    ).toBe(true);
  });
  it("shows a readable sentence without the machine prefix", () => {
    expect(
      readableRpcError({
        message:
          "MFA_REQUIRED: your verification has expired. Verify again with your authenticator app to continue.",
      }),
    ).toBe("your verification has expired. Verify again with your authenticator app to continue.");
    expect(readableRpcError(undefined)).toBe("Something went wrong");
  });
  it("sends the admin to sign in again with Google and back to the same page (0111)", () => {
    const href = mfaVerifyHref();
    expect(href).toMatch(/^\/auth\?/);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("mode")).toBe("login");
    expect(q.get("reauth")).toBe("1");
    expect(q.get("next")).toBe("/admin");
  });
  it("labels the step-up action in plain words", () => {
    expect(STEP_UP_ACTION_LABEL).toBe("Verify it's you");
  });
  it("sends an admin with an authenticator app to the code screen and back (0166)", () => {
    const href = authenticatorHref();
    expect(href).toMatch(/^\/mfa\?/);
    expect(new URLSearchParams(href.split("?")[1]).get("next")).toBe("/admin");
  });
  it("counts only a finished authenticator set-up", () => {
    expect(hasVerifiedAuthenticator({ totp: [{ status: "verified" }] })).toBe(true);
    expect(hasVerifiedAuthenticator({ totp: [{ status: "unverified" }] })).toBe(false);
    expect(hasVerifiedAuthenticator({ totp: [] })).toBe(false);
    expect(hasVerifiedAuthenticator(null)).toBe(false);
  });
});
