// Load-size rules shared by every place a customer picks a quantity (homepage
// price check, /quote and booking), so they all accept the same amounts.
// Display and input only: the server validates and prices the quantity.

/** Under 1 m³ the pricing engine uses a minimum-trip charge (compute_material_offer "small_load"). */
export const MIN_QUANTITY_M3 = 0.25;
export const MAX_QUANTITY_M3 = 30;
export const LOAD_PRESETS_M3 = [10, 15, 20] as const;

export function isValidQuantity(q: number): boolean {
  return Number.isFinite(q) && q >= MIN_QUANTITY_M3 && q <= MAX_QUANTITY_M3;
}

/** One cubic metre per tap, or a quarter below 1 m³; always inside the limits. */
export function stepQuantity(q: number, dir: -1 | 1): number {
  const size = q < 1 || (dir < 0 && q <= 1) ? 0.25 : 1;
  const next = Math.round((q + dir * size) * 100) / 100;
  return Math.min(MAX_QUANTITY_M3, Math.max(MIN_QUANTITY_M3, next));
}

/** Mirrors compute_material_offer's reference-truck trip rule. Display only. */
export function tripsEstimate(q: number): number {
  return q > 20 ? Math.ceil(q / 10) : 1;
}

export function loadHint(q: number): string {
  if (!isValidQuantity(q)) return `Between ${MIN_QUANTITY_M3} and ${MAX_QUANTITY_M3} m³`;
  const trips = tripsEstimate(q);
  return trips > 1 ? `About ${trips} tipper loads` : "About 1 tipper load";
}
