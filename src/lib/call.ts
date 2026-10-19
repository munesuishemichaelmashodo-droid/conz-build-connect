// Phone calls between customer and driver.
//
// Rules (agreed with the owner): a call is only possible between the job's
// customer and the driver whose offer was accepted, and only while the
// delivery is actually under way (accepted / in_progress). Never while the
// job is open for bids (that would let the two sides take the deal off the
// platform and skip the commission) and not after completion. In-app chat
// stays the main channel because it is kept as evidence for disputes.
// The number is only fetched when calling is allowed.
export const CALLABLE_STATUSES = ["accepted", "in_progress"] as const;

export function canCallOnJob(job: { status?: string | null; driver_id?: string | null }): boolean {
  return !!job.driver_id && (CALLABLE_STATUSES as readonly string[]).includes(job.status ?? "");
}

// Plain tap-to-dial link: opens the phone's own dialer.
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = "263" + p.slice(1);
  if (p.length < 9) return null;
  return `tel:+${p}`;
}
