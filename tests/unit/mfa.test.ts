import { describe, expect, it } from "vitest";
import {
  isMfaRequiredError,
  isSecondApprovalError,
  readableRpcError,
  mfaVerifyHref,
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
  it("sends the admin to verify and back to the same page", () => {
    expect(mfaVerifyHref()).toMatch(/^\/mfa\?next=/);
  });
});
