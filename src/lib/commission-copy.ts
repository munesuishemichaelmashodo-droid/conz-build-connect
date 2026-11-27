/**
 * Words for what the 7% commission is charged on. Owner decision (24/11, confirmed 27/11/2026): 7% of the entire
 * agreed job value. A transport-only job: 7% of the agreed transport fare. A job where the driver also supplies the
 * materials: 7% of materials and transport together ($300 + $100 = $400 -> $28). One sentence everywhere, whatever
 * pricing switch is on, so the wording never depends on a setting.
 */
export const COMMISSION_BASE =
  "7% of the total agreed job value: the delivery price when the driver only delivers, or materials and delivery together when the driver also supplies the materials";

/** Kept for callers that still import the old name. */
export const COMMISSION_BASE_TRANSPORT = COMMISSION_BASE;

const LEGACY = /7% of the full job (?:price|value), materials and transport included/g;

/** Replaces the legacy phrase with the approved one. The second argument is no longer used (kept for callers). */
export function commissionCopy(text: string, _transportOn?: boolean): string {
  return text.replace(LEGACY, COMMISSION_BASE);
}
