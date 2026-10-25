// Pure rules for the email sign-in screens (auth, verify-email, oauth-callback,
// reset-password). Kept free of React and Supabase so they can be unit-tested.
// Nothing here grants access: it only decides what the screens show.

/** What an auth redirect URL told us, without keeping any token or provider text. */
export type AuthRedirect = {
  pathname: string;
  /** Supabase's `type` value (recovery, signup, magiclink...), when present. */
  type: string | null;
  /** A PKCE `?code=` was present (the code itself is not kept). */
  hasCode: boolean;
  /** Implicit-flow tokens were present (the tokens are not kept). */
  hasTokens: boolean;
  error: LinkError | null;
};

export type LinkError = { code: string; kind: "expired" | "failed" };

// Codes Supabase uses when an email link or its PKCE state is no longer usable.
const EXPIRED_CODES = new Set([
  "otp_expired",
  "flow_state_expired",
  "flow_state_not_found",
  "bad_code_verifier",
  "email_link_invalid",
]);

const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

export function parseAuthRedirect(loc: {
  pathname: string;
  search: string;
  hash: string;
}): AuthRedirect {
  const q = new URLSearchParams(loc.search.startsWith("?") ? loc.search.slice(1) : loc.search);
  const f = new URLSearchParams(loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash);
  const get = (k: string) => q.get(k) ?? f.get(k);

  const rawError = get("error_code") ?? get("error");
  let error: LinkError | null = null;
  if (rawError !== null) {
    const code = SAFE_CODE.test(rawError) ? rawError : "unknown";
    // Supabase reports an expired email link as error=access_denied plus
    // error_code=otp_expired; access_denied alone is a refused sign-in.
    error = { code, kind: EXPIRED_CODES.has(code) ? "expired" : "failed" };
  }
  const type = get("type");
  return {
    pathname: loc.pathname,
    type: type && SAFE_CODE.test(type) ? type : null,
    hasCode: q.has("code"),
    hasTokens: f.has("access_token") || q.has("access_token"),
    error,
  };
}

export type RecoveryState = "ready" | "expired" | "invalid" | "signed_in_not_recovery";

/**
 * Whether the reset-password form may be shown. A normal signed-in session is
 * not enough: we need Supabase's PASSWORD_RECOVERY event, or a recovery link
 * that landed on this page and produced a session.
 */
export function recoveryState(input: {
  redirect: AuthRedirect;
  recoveryEvent: boolean;
  hasSession: boolean;
}): RecoveryState {
  const { redirect, recoveryEvent, hasSession } = input;
  const onResetPage = redirect.pathname === "/reset-password";
  if (onResetPage && redirect.error) return "expired";
  if (recoveryEvent && hasSession) return "ready";
  const linkEvidence = onResetPage && (redirect.type === "recovery" || redirect.hasCode);
  if (linkEvidence && hasSession) return "ready";
  if (hasSession) return "signed_in_not_recovery";
  return "invalid";
}

export type AuthErrorKind =
  | "email_not_confirmed"
  | "invalid_credentials"
  | "rate_limited"
  | "weak_password"
  | "network"
  | "other";

/** A short, user-facing message for a Supabase auth error. Never echoes URLs or status codes. */
export function describeAuthError(err: unknown): { kind: AuthErrorKind; message: string } {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : 0;

  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return {
      kind: "email_not_confirmed",
      message: "Confirm your email address first. We can send you a new link.",
    };
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return { kind: "invalid_credentials", message: "Email or password is incorrect." };
  }
  if (status === 429 || code.startsWith("over_") || /rate limit/i.test(message)) {
    return {
      kind: "rate_limited",
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }
  if (code === "weak_password" || /password should/i.test(message)) {
    return {
      kind: "weak_password",
      message: "Choose a stronger password (at least 8 characters).",
    };
  }
  if (e.name === "TypeError" || /failed to fetch|network/i.test(message)) {
    return {
      kind: "network",
      message: "Couldn't reach Con Z. Check your connection and try again.",
    };
  }
  return { kind: "other", message: "Something went wrong. Please try again." };
}

/** What to tell someone who arrives with an unusable email or sign-in link. */
export function linkErrorMessage(error: LinkError): string {
  return error.kind === "expired"
    ? "This link has expired or was already used. Request a new one below."
    : "Sign-in didn't finish. Please try again.";
}

/** Supabase lets a user request a confirmation or reset email once every 60 s. */
export const RESEND_COOLDOWN_SECONDS = 60;

export function cooldownRemaining(lastSentAtMs: number | null, nowMs: number): number {
  if (lastSentAtMs === null) return 0;
  const left = RESEND_COOLDOWN_SECONDS - Math.floor((nowMs - lastSentAtMs) / 1000);
  return Math.max(0, left);
}

/**
 * When to record that the user accepted the Terms, or null to leave it alone.
 * - Email sign-up: the acceptance was given at sign-up, so use the account's
 *   creation time (server-side, not a client clock).
 * - Google sign-up: the box was ticked just before the redirect, so use now.
 * - Never overwrite an existing acceptance.
 */
export function resolveTermsAcceptance(input: {
  current: string | null | undefined;
  signupMetadataAccepted: boolean;
  clientAccepted: boolean;
  userCreatedAt: string | null | undefined;
  now: Date;
}): string | null {
  if (input.current) return null;
  if (input.signupMetadataAccepted) {
    const created = input.userCreatedAt ? new Date(input.userCreatedAt) : null;
    return created && !Number.isNaN(created.getTime())
      ? created.toISOString()
      : input.now.toISOString();
  }
  if (input.clientAccepted) return input.now.toISOString();
  return null;
}
