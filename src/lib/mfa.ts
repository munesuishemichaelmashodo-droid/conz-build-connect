// Super-admin money actions require a multi-factor (aal2) session, enforced
// in the database (require_aal2 raises "MFA_REQUIRED: ..."). Credits above
// the second-approval threshold raise "SECOND_APPROVAL_REQUIRED: ...".

type RpcError = { message?: string } | null | undefined;

export function isMfaRequiredError(error: RpcError): boolean {
  return !!error?.message?.includes("MFA_REQUIRED");
}

export function isSecondApprovalError(error: RpcError): boolean {
  return !!error?.message?.includes("SECOND_APPROVAL_REQUIRED");
}

/** Strip the machine-readable prefix for display. */
export function readableRpcError(error: RpcError): string {
  return (error?.message ?? "Something went wrong").replace(/^(MFA_REQUIRED|SECOND_APPROVAL_REQUIRED):\s*/, "");
}

/** Where to send the admin to verify, returning them to the current page. */
export function mfaVerifyHref(): string {
  const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/admin";
  return `/mfa?next=${encodeURIComponent(here)}`;
}
