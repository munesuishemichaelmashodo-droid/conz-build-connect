/**
 * Words for what the 7% commission is charged on. While delivery-only pricing is off (today), the agreed price
 * includes the material, so the long phrase stays as it is. When the owner turns delivery-only pricing on, new jobs
 * are priced for the delivery trip only and the commission is 7% of that agreed fare; the material is arranged
 * separately and is not part of it.
 */
export const COMMISSION_BASE_TRANSPORT = "7% of the agreed delivery fare (materials are not part of it)";

const LEGACY = /7% of the full job (?:price|value), materials and transport included/g;

/** Replaces the legacy phrase only when delivery-only pricing is on. Text without the phrase is returned as is. */
export function commissionCopy(text: string, transportOn: boolean): string {
  return transportOn ? text.replace(LEGACY, COMMISSION_BASE_TRANSPORT) : text;
}
