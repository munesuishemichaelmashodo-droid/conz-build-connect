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

/**
 * The assigned driver can hand an accepted job back until the load is collected. cancel_job (0145)
 * then reopens it for other drivers instead of cancelling it: only for direct-pay jobs (escrow keeps
 * its refund flow), and never once the trip has started (that needs a dispute).
 */
export function driverCanRelease(
  status: string | null | undefined,
  hasPickupPhoto: boolean,
  paymentMethod: string | null | undefined,
): boolean {
  return status === "accepted" && !hasPickupPhoto && paymentMethod === "direct";
}

export const DRIVER_RELEASE_POLICY_TEXT =
  "The job goes back to other drivers and the customer is told. It is recorded as a cancellation on your account, and the commission reserved for you is released.";

/** A plain message for a refusal the customer can act on, or null to show the server's own text. */
export function friendlyAcceptError(message: string | null | undefined): string | null {
  if (message?.includes("DRIVER_BUSY")) {
    return "This driver has just taken another job. Please choose another offer.";
  }
  return null;
}

export const ADMIN_CANCEL_REASON_MIN = 5;

export function adminCancelPolicyText(status: string | null | undefined): string {
  return status === "open"
    ? "The customer is told the job was cancelled. No strike is recorded."
    : "The customer and the driver are told the job was cancelled and the reason below is shown to them. Any held commission is released and any escrow payment is queued for refund. No strike is recorded.";
}

export const NO_SHOW_CANCEL_REASON = "Driver did not start pickup within 24 hours of accepting";

/** Mirrors customer_reopen_no_show_job (0147). A dispute is only known to the server, which refuses then. */
export function customerCanReopenNoShow(
  job: {
    status?: string | null;
    payment_method?: string | null;
    cancellation_reason?: string | null;
    cancelled_at?: string | null;
    driver_arrived_pickup_at?: string | null;
    pickup_photo_url?: string | null;
  },
  now: number = Date.now(),
): boolean {
  if (job.status !== "cancelled" || job.payment_method !== "direct") return false;
  if (job.cancellation_reason !== NO_SHOW_CANCEL_REASON) return false;
  if (job.driver_arrived_pickup_at || job.pickup_photo_url) return false;
  const at = job.cancelled_at ? new Date(job.cancelled_at).getTime() : NaN;
  return Number.isFinite(at) && now - at <= 7 * 24 * 3_600_000;
}
