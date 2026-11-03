/**
 * Customer cancellation, matching cancel_job: free while the job is open; a strike once a driver
 * has accepted (no fee is charged); refused once the trip is in progress — a dispute ("Report a
 * problem") is the route then.
 */
export function customerCanCancel(status: string | null | undefined): boolean {
  return status === "open" || status === "accepted";
}

export function cancelPolicyText(status: string | null | undefined): string {
  return status === "open"
    ? "You can cancel this job for free."
    : "A driver has already accepted this job. Cancelling now counts as a strike on your account.";
}

/**
 * Admin cancellation (cancel_job allows admins at any live stage, including in progress, and
 * records `cancelled_by`). No strike is recorded because the caller is not the customer or driver.
 */
export function adminCanCancel(status: string | null | undefined): boolean {
  return status === "open" || status === "accepted" || status === "in_progress";
}

export const ADMIN_CANCEL_REASON_MIN = 5;

export function adminCancelPolicyText(status: string | null | undefined): string {
  return status === "open"
    ? "The customer is told the job was cancelled. No strike is recorded."
    : "The customer and the driver are told the job was cancelled and the reason below is shown to them. Any held commission is released and any escrow payment is queued for refund. No strike is recorded.";
}
