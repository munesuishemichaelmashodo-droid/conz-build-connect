// Sensitive admin money and role actions need a fresh step-up, enforced in the
// database (require_aal2 raises "MFA_REQUIRED: ..."). Since 0111 a Google sign-in
// from the last 12 hours counts (an authenticator code still works too), so the
// screens ask the admin to sign in again with Google. Credits above the
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

export const STEP_UP_ACTION_LABEL = "Sign in again with Google";

/** The sign-in page, explaining why, returning the admin to the current page. */
export function mfaVerifyHref(): string {
  const here =
    typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin";
  return `/auth?${new URLSearchParams({ mode: "login", reauth: "1", next: here }).toString()}`;
}

/**
 * Signs out on this device and opens the sign-in page, so the next Google sign-in
 * is fresh. The sign-in page sends anyone still signed in straight on, which is
 * why the local session is ended first.
 */
export async function startStepUp(): Promise<void> {
  const href = mfaVerifyHref();
  const { supabase } = await import("@/integrations/supabase/client");
  await supabase.auth.signOut({ scope: "local" });
  window.location.assign(href);
}
