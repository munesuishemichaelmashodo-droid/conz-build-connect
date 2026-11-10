// Sensitive admin money and role actions need a fresh step-up, enforced in the
// database (require_aal2 raises "MFA_REQUIRED: ..."). Since 0111 a Google sign-in
// from the last 12 hours counts. Since 0166 an admin who has set up an authenticator
// app must use its code instead (Google alone is refused for that account), so the
// step-up button goes to the code screen for them and to Google for everyone else. Credits above the
// second-approval threshold raise "SECOND_APPROVAL_REQUIRED: ...".

type RpcError = { message?: string } | null | undefined;

export function isMfaRequiredError(error: RpcError): boolean {
  return !!error?.message?.includes("MFA_REQUIRED");
}

export function isSecondApprovalError(error: RpcError): boolean {
  return !!error?.message?.includes("SECOND_APPROVAL_REQUIRED");
}

/** Strip the machine-readable prefix for display. */
export function readableRpcError(error: RpcError): string {
  return (error?.message ?? "Something went wrong").replace(
    /^(MFA_REQUIRED|SECOND_APPROVAL_REQUIRED):\s*/,
    "",
  );
}

export const STEP_UP_ACTION_LABEL = "Verify it's you";

/** The sign-in page, explaining why, returning the admin to the current page. */
export function mfaVerifyHref(): string {
  const here =
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin";
  return `/auth?${new URLSearchParams({ mode: "login", reauth: "1", next: here }).toString()}`;
}

/** The authenticator-code screen, returning the admin to the current page. */
export function authenticatorHref(): string {
  const here =
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin";
  return `/mfa?${new URLSearchParams({ next: here }).toString()}`;
}

type FactorList = { totp?: { status?: string }[] } | null | undefined;

/** True when this account has a finished (verified) authenticator app. */
export function hasVerifiedAuthenticator(factors: FactorList): boolean {
  return (factors?.totp ?? []).some((f) => f.status === "verified");
}

/**
 * Starts the step-up. With an authenticator app set up: the code screen (no sign-out).
 * Otherwise: signs out on this device and opens the sign-in page, so the next Google
 * sign-in is fresh. The sign-in page sends anyone still signed in straight on, which is
 * why the local session is ended first.
 */
export async function startStepUp(): Promise<void> {
  const { supabase } = await import("@/integrations/supabase/client");
  try {
    const { data } = await supabase.auth.mfa.listFactors();
    if (hasVerifiedAuthenticator(data as FactorList)) {
      window.location.assign(authenticatorHref());
      return;
    }
  } catch {
    // could not read the factors: fall through to the Google path, which the server still checks
  }
  const href = mfaVerifyHref();
  await supabase.auth.signOut({ scope: "local" });
  window.location.assign(href);
}
