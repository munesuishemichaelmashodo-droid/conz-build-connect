// A referral link (?ref=CODE) must survive a Google sign-up, which leaves the app and comes back. The code is
// remembered in this tab and passed to activateAccount, which redeems it only on the account's FIRST activation
// (record_referral then refuses self-referral and a second code). Storage failures are ignored: the worst case is
// an unattributed sign-up.

const KEY = "conz.pendingReferralCode";

/** Referral codes are short upper-case letters and digits; anything else is ignored. */
export function normaliseReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(c) ? c : null;
}

export function rememberPendingReferral(raw: unknown): void {
  const c = normaliseReferralCode(raw);
  if (!c) return;
  try {
    sessionStorage.setItem(KEY, c);
  } catch {
    /* ignore */
  }
}

export function readPendingReferral(): string | null {
  try {
    return normaliseReferralCode(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
