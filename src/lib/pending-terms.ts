// A Google sign-up leaves the app for Google and comes back, so the "I accept
// the Terms" tick is remembered in this tab until activateAccount records it
// on the user's own profile (audit A-1). Email sign-ups use sign-up metadata
// instead. Storage failures are ignored: the worst case is an unrecorded tick.

const KEY = "conz.pendingTermsAcceptance";

export function rememberPendingTermsAcceptance(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
}

export function readPendingTermsAcceptance(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearPendingTermsAcceptance(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
