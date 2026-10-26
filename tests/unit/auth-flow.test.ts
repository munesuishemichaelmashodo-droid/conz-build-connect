import { describe, expect, it } from "vitest";
import {
  RESEND_COOLDOWN_SECONDS,
  cooldownRemaining,
  describeAuthError,
  linkErrorMessage,
  needsTermsAcceptance,
  parseAuthRedirect,
  recentRecoveryAmr,
  recoveryState,
  resolveTermsAcceptance,
  signUpOutcome,
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
  const NOW = 1_800_000_000; // seconds
  const jwt = (payload: object) =>
    `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
  const recoveryToken = jwt({ sub: "u1", amr: [{ method: "recovery", timestamp: NOW - 60 }] });
  const oldRecoveryToken = jwt({ sub: "u1", amr: [{ method: "recovery", timestamp: NOW - 7200 }] });
  const passwordToken = jwt({ sub: "u1", amr: [{ method: "password", timestamp: NOW - 60 }] });

  const at = (pathname: string, search = "", hash = "") =>
    parseAuthRedirect({ pathname, search, hash });
  const plainLoad = at("/reset-password");
  const state = (
    redirect: ReturnType<typeof parseAuthRedirect>,
    recoveryEvent: boolean,
    accessToken: string | null,
  ) => recoveryState({ redirect, recoveryEvent, accessToken, nowSeconds: NOW });

  it("is ready when Supabase reported a password-recovery event", () => {
    expect(state(plainLoad, true, passwordToken)).toBe("ready");
  });

  it("is ready when the session itself was created by a recovery link", () => {
    expect(state(at("/reset-password", "", "#type=recovery"), false, recoveryToken)).toBe("ready");
  });

  it("does not accept a normal signed-in session", () => {
    expect(state(plainLoad, false, passwordToken)).toBe("signed_in_not_recovery");
  });

  it("does not let a made-up ?code= unlock the form for a normal session", () => {
    expect(state(at("/reset-password", "?code=anything"), false, passwordToken)).toBe(
      "signed_in_not_recovery",
    );
  });

  it("does not let a made-up #type=recovery unlock the form for a normal session", () => {
    expect(
      state(at("/reset-password", "", "#access_token=junk&type=recovery"), false, passwordToken),
    ).toBe("signed_in_not_recovery");
  });

  it("does not accept a recovery sign-in older than an hour", () => {
    expect(state(plainLoad, false, oldRecoveryToken)).toBe("signed_in_not_recovery");
  });

  it("treats a malformed token as a normal session", () => {
    expect(state(plainLoad, false, "not-a-jwt")).toBe("signed_in_not_recovery");
  });

  it("is invalid with no session", () => {
    expect(state(plainLoad, false, null)).toBe("invalid");
    expect(state(at("/reset-password", "?code=abc"), false, null)).toBe("invalid");
  });

  it("is expired when the link carried an expiry error, even with an old session", () => {
    expect(
      state(
        at("/reset-password", "", "#error=access_denied&error_code=otp_expired"),
        false,
        passwordToken,
      ),
    ).toBe("expired");
  });

  it("shows an expired link as expired even if a recovery session exists from before", () => {
    expect(
      state(
        at("/reset-password", "?error=access_denied&error_code=otp_expired"),
        false,
        recoveryToken,
      ),
    ).toBe("expired");
  });
});

describe("recentRecoveryAmr", () => {
  const NOW = 1_800_000_000;
  const jwt = (payload: object) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
  it("needs a recovery entry within the window", () => {
    expect(
      recentRecoveryAmr(jwt({ amr: [{ method: "recovery", timestamp: NOW - 10 }] }), NOW),
    ).toBe(true);
    expect(recentRecoveryAmr(jwt({ amr: [{ method: "otp", timestamp: NOW - 10 }] }), NOW)).toBe(
      false,
    );
    expect(
      recentRecoveryAmr(jwt({ amr: [{ method: "recovery", timestamp: NOW + 600 }] }), NOW),
    ).toBe(false);
    expect(recentRecoveryAmr(jwt({}), NOW)).toBe(false);
    expect(recentRecoveryAmr("", NOW)).toBe(false);
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

describe("needsTermsAcceptance", () => {
  const base = {
    loading: false,
    userId: "u1",
    profile: { terms_accepted_at: null },
    path: "/home",
  };
  it("asks a signed-in user with no recorded acceptance", () => {
    expect(needsTermsAcceptance(base)).toBe(true);
  });
  it("does not ask once accepted", () => {
    expect(
      needsTermsAcceptance({ ...base, profile: { terms_accepted_at: "2026-10-25T00:00:00Z" } }),
    ).toBe(false);
  });
  it("does not ask signed-out visitors or before the profile loads", () => {
    expect(needsTermsAcceptance({ ...base, userId: null })).toBe(false);
    expect(needsTermsAcceptance({ ...base, profile: null })).toBe(false);
    expect(needsTermsAcceptance({ ...base, loading: true })).toBe(false);
  });
  it("lets them read the Terms and finish a reset first", () => {
    expect(needsTermsAcceptance({ ...base, path: "/terms" })).toBe(false);
    expect(needsTermsAcceptance({ ...base, path: "/privacy" })).toBe(false);
    expect(needsTermsAcceptance({ ...base, path: "/reset-password" })).toBe(false);
  });
});

describe("signUpOutcome", () => {
  it("is signed in when sign-up returned a session", () => {
    expect(signUpOutcome({ hasSession: true, identityCount: 1 })).toBe("signed_in");
  });
  it("spots an email that already has an account (no identities, nothing emailed)", () => {
    expect(signUpOutcome({ hasSession: false, identityCount: 0 })).toBe("existing_account");
  });
  it("asks a new user to check their email", () => {
    expect(signUpOutcome({ hasSession: false, identityCount: 1 })).toBe("check_email");
  });
  it("treats a missing identity list as a new user (older responses)", () => {
    expect(signUpOutcome({ hasSession: false, identityCount: null })).toBe("check_email");
  });
});
