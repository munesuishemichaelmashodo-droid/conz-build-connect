// A referral link (?ref=CODE) must survive leaving the app: a Google sign-up (which leaves and comes back), or a
// person who opens the link, closes it and signs up days later. The code is remembered on this device for 30 days
// (localStorage, with the tab's sessionStorage as a fallback) and passed to activateAccount, which redeems it only
// on the account's FIRST activation (record_referral refuses self-referral, a second code and accounts that are not
// new). Storage failures are ignored: the worst case is an unattributed sign-up, which a super admin can correct
// (admin_set_referral_attribution, audited).

const KEY = "conz.pendingReferralCode";
export const PENDING_REFERRAL_DAYS = 30;

/** Referral codes are short upper-case letters and digits; anything else is ignored. */
export function normaliseReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z0-9]{4,20}$/.test(c) ? c : null;
}

type Stored = { code: string; at: number };

export function rememberPendingReferral(raw: unknown, now = Date.now()): void {
  const c = normaliseReferralCode(raw);
  if (!c) return;
  const value = JSON.stringify({ code: c, at: now } satisfies Stored);
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(KEY, value);
  } catch {
    /* ignore */
  }
}

function parse(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.at !== "number" || now - v.at > PENDING_REFERRAL_DAYS * 86_400_000) return null;
    return normaliseReferralCode(v.code);
  } catch {
    return normaliseReferralCode(raw); // a code stored by the earlier version (plain text, this tab only)
  }
}

export function readPendingReferral(now = Date.now()): string | null {
  let fromLocal: string | null = null;
  try {
    fromLocal = parse(localStorage.getItem(KEY), now);
  } catch {
    /* ignore */
  }
  if (fromLocal) return fromLocal;
  try {
    return parse(sessionStorage.getItem(KEY), now);
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  for (const store of ["localStorage", "sessionStorage"] as const) {
    try {
      globalThis[store].removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
