// The admin authenticator prompt (0169). The database decides; this file only words it.
//  - no authenticator yet: "Set up" (and, when the owners switched "required" on, money and role
//    actions are refused until it is)
//  - authenticator set up but not checked for 30 days: "Verify" (the admin screens send them to the code page)
//  - otherwise: a quiet "verified, N days left" line
// Crucial changes (money, roles) ask for a fresh code every time, whatever this says.

export const AUTHENTICATOR_MAX_AGE_DAYS = 30;

export type AuthenticatorPolicy = {
  required: boolean;
  has_authenticator: boolean;
  last_verified_at: string | null;
  max_age_days: number;
  expired: boolean;
  days_left: number | null;
};

export type AuthenticatorPrompt =
  | { kind: "setup"; title: string; body: string; cta: string; urgent: boolean }
  | { kind: "verify"; title: string; body: string; cta: string; urgent: true }
  | { kind: "ok"; title: string; body: string; cta: string; urgent: false };

/** Reads the policy defensively: anything unreadable means "do not block". */
export function parsePolicy(raw: unknown): AuthenticatorPolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.has_authenticator !== "boolean") return null;
  return {
    required: r.required === true,
    has_authenticator: r.has_authenticator,
    last_verified_at: typeof r.last_verified_at === "string" ? r.last_verified_at : null,
    max_age_days: typeof r.max_age_days === "number" ? r.max_age_days : AUTHENTICATOR_MAX_AGE_DAYS,
    expired: r.expired === true,
    days_left: typeof r.days_left === "number" ? r.days_left : null,
  };
}

export function authenticatorPrompt(p: AuthenticatorPolicy): AuthenticatorPrompt {
  if (!p.has_authenticator) {
    return {
      kind: "setup",
      urgent: p.required,
      title: p.required ? "Set up your authenticator app" : "Protect this admin account",
      body: p.required
        ? "Money and role changes now need a code from your authenticator app. Set it up first; it takes a minute."
        : "Add an authenticator app. Money and role changes then need a fresh code from your phone.",
      cta: "Set up authenticator",
    };
  }
  if (p.expired) {
    return {
      kind: "verify",
      urgent: true,
      title: "Verify your authenticator",
      body: `Enter a code from your authenticator app. It is needed at least every ${p.max_age_days} days.`,
      cta: "Verify now",
    };
  }
  const left = p.days_left;
  return {
    kind: "ok",
    urgent: false,
    title: "Authenticator verified",
    body:
      left == null
        ? "Crucial changes (money, roles) ask for a fresh code each time."
        : `${left} ${left === 1 ? "day" : "days"} until the next check. Crucial changes (money, roles) ask for a fresh code each time.`,
    cta: "Verify again",
  };
}

/** The admin area is closed to an admin whose authenticator check is older than the limit. */
export function mustVerifyBeforeAdmin(p: AuthenticatorPolicy | null): boolean {
  return !!p && p.has_authenticator && p.expired;
}
