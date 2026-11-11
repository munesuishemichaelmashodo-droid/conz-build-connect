// Making "Confirm booking" safe to retry.
//
// The booking is a direct insert into `jobs`. On a weak mobile connection the insert can succeed
// while its reply is lost, and the customer taps again. A quoted booking is then refused because a
// quote is single-use, with the misleading message "quote missing or expired", although the job
// exists. An open request (no quote) has no such protection and would be created twice.
//
// Each booking attempt therefore carries its own job id. The database primary key makes the id
// unique, and after any failed insert the screen looks the id up: if the job is there, the first
// attempt worked and the customer is simply taken to it.

export function newBookingAttemptId(): string {
  return crypto.randomUUID();
}

export type BookingOutcome =
  { kind: "created" } | { kind: "already_created" } | { kind: "failed"; message: string };

const FALLBACK_MESSAGE = "We could not post your job. Check your connection and try again.";

/**
 * Decides what to tell the customer after an insert attempt.
 * `existingJobId` is the id of a job found under this attempt's id after a failed insert (or null).
 */
export function bookingOutcome(
  insertError: { message?: string } | null | undefined,
  existingJobId: string | null | undefined,
  attemptId: string,
): BookingOutcome {
  if (!insertError) return { kind: "created" };
  if (existingJobId && existingJobId === attemptId) return { kind: "already_created" };
  return { kind: "failed", message: insertError.message?.trim() || FALLBACK_MESSAGE };
}
