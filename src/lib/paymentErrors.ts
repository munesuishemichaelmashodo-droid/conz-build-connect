// Turns raw errors from payment/wallet calls into text a driver can act on.
//
// Two kinds of raw text reach the wallet screens today:
//  * transport failures ("Failed to fetch", "Load failed") when the phone
//    loses signal mid-request, and
//  * machine codes from the Paynow server functions ("paynow_timeout").
// Neither means anything to a driver, and a transport failure is dangerous to
// leave vague: the request may or may not have reached the server, so the
// message tells them to check before retrying (the database is idempotent, but
// the person should not have to know that).
//
// Messages the database raises on purpose (rate limits, "Insufficient
// available balance…", "Your wallet is limited…") are already written for the
// user and pass through unchanged.

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|econnreset|econnrefused|etimedout|timed out|offline/i;

export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach the server. Check your connection, then look at your Requests tab before trying again — your request may already have gone through.";

const PAYNOW_CODES: Record<string, string> = {
  paynow_not_configured: "Online payments are unavailable right now. Please contact support.",
  paynow_timeout: "Paynow took too long to respond. Nothing was charged. Please try again.",
  paynow_unreachable: "We couldn't reach Paynow. Nothing was charged. Please try again shortly.",
  paynow_rejected: "Paynow declined to start this payment. Nothing was charged.",
  paynow_bad_response: "Paynow sent an unexpected reply. Nothing was charged. Please try again.",
  paynow_bad_signature: "Paynow's reply could not be verified, so the payment was not started.",
  paynow_bad_poll_url: "Paynow's reply could not be verified, so the payment was not started.",
  payment_create_failed: "We couldn't start this payment. Nothing was charged. Please try again.",
  escrow_unavailable: "Con Z Pay is not available yet. Please pay the driver directly.",
  already_paid: "This job has already been paid for.",
  job_not_payable: "This job can't be paid for right now.",
  job_not_found: "We couldn't find that job.",
  not_your_job: "Only the customer who booked this job can pay for it.",
};

export const GENERIC_PAYMENT_ERROR = "Something went wrong. Please try again.";

function messageOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as { message?: unknown }).message === "string"
  ) {
    return (raw as { message: string }).message;
  }
  return "";
}

export function friendlyPaymentError(
  raw: unknown,
  fallback: string = GENERIC_PAYMENT_ERROR,
): string {
  const text = messageOf(raw).trim();
  if (!text) return fallback;
  const code = PAYNOW_CODES[text];
  if (code) return code;
  if (NETWORK_PATTERN.test(text)) return NETWORK_ERROR_MESSAGE;
  // Machine-looking tokens (snake_case, no spaces) are not for humans.
  if (/^[a-z0-9_]+$/i.test(text)) return fallback;
  // "WITHDRAWALS_PAUSED: …" — drop the machine prefix, keep the sentence the database wrote.
  return text.replace(/^[A-Z][A-Z_]{3,}:\s*/, "");
}

/** Smallest top-up the UI offers and the server accepts (USD). */
export const MIN_TOPUP_USD = 1;
export const MAX_TOPUP_USD = 100000;

/** Validates a top-up amount; returns an error message or null. */
export function topupAmountError(amount: unknown): string | null {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "Enter an amount";
  if (n < MIN_TOPUP_USD) return `The minimum top-up is $${MIN_TOPUP_USD}`;
  if (n > MAX_TOPUP_USD) return `The maximum top-up is $${MAX_TOPUP_USD.toLocaleString("en-US")}`;
  return null;
}
