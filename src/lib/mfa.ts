export function isMfaRequiredError(error: { message?: string } | null | undefined): boolean {
  return !!error?.message?.includes("MFA_REQUIRED");
}
