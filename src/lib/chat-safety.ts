// Gentle in-chat warnings (owner's brief 26/11). Nothing is blocked or hidden: phone numbers, addresses and payment
// details are often needed to coordinate a delivery. When the OTHER person's message looks like a request to pay
// early, pay someone else, or move the deal outside Con Z, the reader sees a short warning and a link to report it.
// Plain pattern matching on the message text the reader already has; nothing is sent anywhere.

export type ChatSafetyFlag = "payment_request" | "off_platform" | null;

const PAYMENT = [
  /\b(pay|send|transfer)\b[^.?!]{0,40}\b(first|now|before|upfront|up front|in advance|advance)\b/i,
  /\b(deposit|advance payment|booking fee|registration fee|processing fee)\b/i,
  /\b(send|pay)\b[^.?!]{0,30}\b(to (this|my|another|a different) (number|account|wallet)|my (wife|brother|sister|friend|boss))\b/i,
  /\bcon ?z (fee|charge|payment)\b/i,
];
const OFF_PLATFORM = [
  /\b(off|outside|without|skip|avoid|bypass)\b[^.?!]{0,20}\bcon ?z\b/i,
  /\b(don'?t|do not|no need to) (use|book (on|through)) (the )?(app|con ?z)\b/i,
  /\bcheaper (if|when) (we|you) (deal|go) direct/i,
];

export function chatSafetyFlag(text: string | null | undefined): ChatSafetyFlag {
  if (!text) return null;
  if (PAYMENT.some((r) => r.test(text))) return "payment_request";
  if (OFF_PLATFORM.some((r) => r.test(text))) return "off_platform";
  return null;
}

export function chatSafetyMessage(flag: Exclude<ChatSafetyFlag, null>): string {
  return flag === "payment_request"
    ? "Be careful: pay only the driver of this job, the agreed amount, at the agreed time. Con Z never asks you to pay Con Z or anyone else for a delivery."
    : "Deals made outside Con Z have no job record, no delivery code and no dispute help.";
}

export function chatSafetyReportCategory(flag: Exclude<ChatSafetyFlag, null>) {
  return flag === "payment_request" ? ("fraud_scam" as const) : ("off_platform_request" as const);
}
