// Delivery-confirmation helpers shared by the customer "confirm delivery" button
// and the driver's PIN entry.
//
// The database (migration 0096) is the security boundary: it decides whether a
// photo exists and whether the code is right. These helpers only keep the app
// compatible with BOTH database versions during a rollout:
//   - before 0096: complete_job(_job_id) only, and direct-pay jobs have no code;
//   - after 0096:  complete_job(_job_id, _pin) and every accepted job has a code.
// They never decide that a delivery is confirmed on their own.

import { rpcFailure } from "@/lib/rpc-result";

type ErrorLike = { message?: string; code?: string } | null | undefined;

/** PostgREST says this when the called signature does not exist (database older than the app). */
export function isMissingFunctionError(error: ErrorLike): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    /could not find the function/i.test(error.message ?? "") ||
    /schema cache/i.test(error.message ?? "")
  );
}

/** Arguments for complete_job: the code is sent when we have one, omitted otherwise (the server decides). */
export function completeJobArgs(jobId: string, pin: string | null | undefined, includePin = true) {
  const code = (pin ?? "").trim();
  return includePin && code ? { _job_id: jobId, _pin: code } : { _job_id: jobId };
}

export type CompleteOutcome =
  | { kind: "confirmed"; already: boolean }
  | { kind: "failed"; reason: string; message: string; refreshCode: boolean };

const FRIENDLY: Record<string, string> = {
  wrong_pin: "That code doesn't match. Check it and try again.",
  pin_expired: 'This delivery code has expired. Tap "New code" to get a fresh one.',
  pin_used: "This delivery code was already used.",
  locked: "Too many wrong codes. Wait a little and try again.",
};

/** Turns the RPC's returned JSON into something the screen can act on. */
export function interpretCompleteResult(data: unknown): CompleteOutcome {
  const failed = rpcFailure(data);
  if (failed) {
    return {
      kind: "failed",
      reason: failed.error,
      message: FRIENDLY[failed.error] ?? failed.message,
      refreshCode: failed.error === "pin_expired" || failed.error === "pin_used",
    };
  }
  const already = !!(
    data &&
    typeof data === "object" &&
    (data as { already?: unknown }).already === true
  );
  return { kind: "confirmed", already };
}

/** Friendly text for errors the server RAISES on the confirm paths. */
export function deliveryConfirmErrorMessage(raw: string): string {
  if (/delivery code is required/i.test(raw)) {
    return 'Enter your delivery code to confirm. Tap "New code" if you can\'t see it.';
  }
  if (/evidence|upload the delivery photo/i.test(raw)) {
    return "The driver's delivery photo hasn't been uploaded yet.";
  }
  if (/does not use delivery pin/i.test(raw)) {
    return "This delivery is confirmed by the customer in their app.";
  }
  if (/incorrect code/i.test(raw))
    return "That code doesn't match. Double check with the customer.";
  if (/no confirmed escrow payment/i.test(raw))
    return "The customer hasn't paid through Con Z Pay yet.";
  if (/only the customer/i.test(raw)) return "Only the customer can confirm this delivery.";
  return raw;
}
