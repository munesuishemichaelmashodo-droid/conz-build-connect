import { describe, expect, it } from "vitest";
import {
  RESEND_COOLDOWN_SECONDS,
  cooldownRemaining,
  describeAuthError,
  linkErrorMessage,
  parseAuthRedirect,
  recoveryState,
  resolveTermsAcceptance,
} from "@/lib/auth-flow";

describe("parseAuthRedirect", () => {
  it("recognises an implicit-flow recovery link without keeping the tokens", () => {
    const r = parseAuthRedirect({
      pathname: "/reset-password",
      search: "",
      hash: "#access_token=SECRET&refresh_token=SECRET2&expires_in=3600&token_type=bearer&type=recovery",
    });
    expect(r.type).toBe("recovery");
    expect(r.hasTokens).toBe(true);
    expect(r.error).toBeNull();
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("recognises a PKCE code on the reset page", () => {
    const r = parseAuthRedirect({ pathname: "/reset-password", search: "?code=abc123", hash: "" });
    expect(r.hasCode).toBe(true);
    expect(JSON.stringify(r)).not.toContain("abc123");
  });

  it("reads an expired-link error from the fragment", () => {
    const r = parseAuthRedirect({
      pathname: "/oauth-callback",
      search: "",
      hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    });
    expect(r.error).toEqual({ code: "otp_expired", kind: "expired" });
  });

  it("reads an error from the query string too", () => {
    const r = parseAuthRedirect({
      pathname: "/reset-password",
      search: "?error=access_denied&error_code=flow_state_not_found",
      hash: "",
    });
    expect(r.error?.kind).toBe("expired");
  });

  it("treats an unknown error as a failed sign-in, not an expired link", () => {
    const r = parseAuthRedirect({
      pathname: "/oauth-callback",
      search: "?error=sign_in_failed",
      hash: "",
    });
    expect(r.error).toEqual({ code: "sign_in_failed", kind: "failed" });
  });

  it("never copies the provider's error text", () => {
    const r = parseAuthRedirect({
      pathname: "/oauth-callback",
      search: "?error=server_error&error_description=%3Cscript%3E",
      hash: "",
    });
    expect(JSON.stringify(r)).not.toContain("script");
    expect(r.error?.code).toBe("server_error");
  });

  it("drops error codes that are not plain identifiers", () => {
    const r = parseAuthRedirect({
      pathname: "/oauth-callback",
      search: "?error=%3Cb%3Ehi",
      hash: "",
    });
    expect(r.error).toEqual({ code: "unknown", kind: "failed" });
  });

  it("returns nothing special for a plain page load", () => {
    const r = parseAuthRedirect({ pathname: "/home", search: "", hash: "" });
    expect(r).toEqual({
      pathname: "/home",
      type: null,
      hasCode: false,
      hasTokens: false,
      error: null,
    });
  });
});

describe("recoveryState", () => {
  const recoveryLink = parseAuthRedirect({
    pathname: "/reset-password",
    search: "",
    hash: "#access_token=x&type=recovery",
  });
  const plainLoad = parseAuthRedirect({ pathname: "/reset-password", search: "", hash: "" });
  const expiredLink = parseAuthRedirect({
    pathname: "/reset-password",
    search: "",
    hash: "#error=access_denied&error_code=otp_expired",
  });

  it("is ready when Supabase reported a password-recovery event", () => {
    expect(recoveryState({ redirect: plainLoad, recoveryEvent: true, hasSession: true })).toBe(
      "ready",
    );
  });

  it("is ready for a recovery link that produced a session", () => {
    expect(recoveryState({ redirect: recoveryLink, recoveryEvent: false, hasSession: true })).toBe(
      "ready",
    );
  });

  it("does not accept a normal signed-in session", () => {
    expect(recoveryState({ redirect: plainLoad, recoveryEvent: false, hasSession: true })).toBe(
      "signed_in_not_recovery",
    );
  });

  it("is invalid with no session and no link", () => {
    expect(recoveryState({ redirect: plainLoad, recoveryEvent: false, hasSession: false })).toBe(
      "invalid",
    );
  });

  it("is invalid when a recovery link produced no session", () => {
    expect(recoveryState({ redirect: recoveryLink, recoveryEvent: false, hasSession: false })).toBe(
      "invalid",
    );
  });

  it("is expired when the link carried an expiry error, even with an old session", () => {
    expect(recoveryState({ redirect: expiredLink, recoveryEvent: false, hasSession: true })).toBe(
      "expired",
    );
  });

  it("ignores recovery evidence captured on a different page", () => {
    const elsewhere = parseAuthRedirect({ pathname: "/home", search: "", hash: "#type=recovery" });
    expect(recoveryState({ redirect: elsewhere, recoveryEvent: false, hasSession: true })).toBe(
      "signed_in_not_recovery",
    );
  });
});

describe("describeAuthError", () => {
  it("spots an unconfirmed email by code", () => {
    expect(
      describeAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }).kind,
    ).toBe("email_not_confirmed");
  });

  it("spots an unconfirmed email by message on older clients", () => {
    expect(describeAuthError({ message: "Email not confirmed" }).kind).toBe("email_not_confirmed");
  });

  it("maps rate limits to a wait message", () => {
    const d = describeAuthError({ status: 429, code: "over_email_send_rate_limit", message: "x" });
    expect(d.kind).toBe("rate_limited");
    expect(d.message).toMatch(/wait/i);
  });

  it("keeps wrong-password messages generic", () => {
    const d = describeAuthError({
      code: "invalid_credentials",
      message: "Invalid login credentials",
    });
    expect(d.kind).toBe("invalid_credentials");
    expect(d.message).toBe("Email or password is incorrect.");
  });

  it("maps network failures", () => {
    expect(describeAuthError(new TypeError("Failed to fetch")).kind).toBe("network");
  });

  it("never shows endpoints or status codes", () => {
    const d = describeAuthError({
      status: 500,
      code: "unexpected_failure",
      message: "boom at https://x.supabase.co/auth/v1",
    });
    expect(d.message).not.toMatch(/supabase|500|auth\/v1/);
  });
});

describe("linkErrorMessage", () => {
  it("explains expired links with a next step", () => {
    expect(linkErrorMessage({ code: "otp_expired", kind: "expired" })).toMatch(
      /expired or was already used/i,
    );
  });
  it("explains a failed sign-in", () => {
    expect(linkErrorMessage({ code: "sign_in_failed", kind: "failed" })).toMatch(/didn't finish/i);
  });
});

describe("cooldownRemaining", () => {
  it("is 0 before anything was sent", () => {
    expect(cooldownRemaining(null, 1_000_000)).toBe(0);
  });
  it("counts down from the cooldown", () => {
    expect(cooldownRemaining(1_000_000, 1_000_000 + 15_000)).toBe(RESEND_COOLDOWN_SECONDS - 15);
  });
  it("reaches 0 after the cooldown", () => {
    expect(cooldownRemaining(1_000_000, 1_000_000 + RESEND_COOLDOWN_SECONDS * 1000 + 1)).toBe(0);
  });
});

describe("resolveTermsAcceptance", () => {
  const createdAt = "2026-10-25T08:00:00.000Z";
  const now = new Date("2026-10-25T09:30:00.000Z");

  it("records email sign-up acceptance at the account's creation time (no session at sign-up)", () => {
    expect(
      resolveTermsAcceptance({
        current: null,
        signupMetadataAccepted: true,
        clientAccepted: false,
        userCreatedAt: createdAt,
        now,
      }),
    ).toBe(createdAt);
  });

  it("records Google sign-up acceptance at first activation", () => {
    expect(
      resolveTermsAcceptance({
        current: null,
        signupMetadataAccepted: false,
        clientAccepted: true,
        userCreatedAt: createdAt,
        now,
      }),
    ).toBe(now.toISOString());
  });

  it("never overwrites an existing acceptance", () => {
    expect(
      resolveTermsAcceptance({
        current: "2026-08-01T00:00:00.000Z",
        signupMetadataAccepted: true,
        clientAccepted: true,
        userCreatedAt: createdAt,
        now,
      }),
    ).toBeNull();
  });

  it("records nothing without any acceptance signal", () => {
    expect(
      resolveTermsAcceptance({
        current: null,
        signupMetadataAccepted: false,
        clientAccepted: false,
        userCreatedAt: createdAt,
        now,
      }),
    ).toBeNull();
  });

  it("falls back to now when the creation time is missing or invalid", () => {
    expect(
      resolveTermsAcceptance({
        current: null,
        signupMetadataAccepted: true,
        clientAccepted: false,
        userCreatedAt: "nope",
        now,
      }),
    ).toBe(now.toISOString());
  });
});
