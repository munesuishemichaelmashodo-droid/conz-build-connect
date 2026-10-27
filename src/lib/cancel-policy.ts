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
