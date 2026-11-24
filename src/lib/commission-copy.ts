/**
 * Words for what the 7% commission is charged on. Owner rule (24/11/2026): ConZ earns 7% of the total agreed
 * deal charge, materials and transport together (materials $300 + transport $100 = $400 deal -> $28).
 * While delivery-only pricing is off (today) the agreed price includes the material, so the existing phrase
 * is already right. When delivery-only pricing is on, a job may hold transport only, so the phrase says the
 * commission is on the total agreed price, whatever the job includes; it never says materials are excluded.
 */
export const COMMISSION_BASE_TRANSPORT =
  "7% of the total agreed price for the job, including materials and transport where the job includes them";

const LEGACY = /7% of the full job (?:price|value), materials and transport included/g;

/** Replaces the legacy phrase only when delivery-only pricing is on. Text without the phrase is returned as is. */
export function commissionCopy(text: string, transportOn: boolean): string {
  return transportOn ? text.replace(LEGACY, COMMISSION_BASE_TRANSPORT) : text;
}
