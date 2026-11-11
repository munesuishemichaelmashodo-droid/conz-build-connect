// Operating assumptions shared with compute_material_offer (0127). The database engine is the
// only calculator; these mirror its fallback rules so the app never shows a different number
// from the one the engine uses.
//   diesel_price_per_liter: valid 0 < x <= 100, else $2.04
//   fuel_l_per_100km:       valid 10..80, else 32
//   long_haul_markup:       valid 1..3, else 1.87

export const DIESEL_FALLBACK_PER_LITRE = 2.04;
export const FUEL_FALLBACK_L_PER_100KM = 32;
export const LONG_HAUL_FALLBACK_MARKUP = 1.87;
export const FUEL_RANGE = { min: 10, max: 80 } as const;
export const MARKUP_RANGE = { min: 1, max: 3 } as const;

export type Assumption = { value: number; source: "setting" | "default" };

/** A setting value as stored (number, numeric string or anything else) -> number or null. */
export function settingNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && /^[0-9]+(\.[0-9]+)?$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

export function resolveDiesel(raw: unknown): Assumption {
  const v = settingNumber(raw);
  return v != null && v > 0 && v <= 100
    ? { value: v, source: "setting" }
    : { value: DIESEL_FALLBACK_PER_LITRE, source: "default" };
}

export function resolveFuel(raw: unknown): Assumption {
  const v = settingNumber(raw);
  return v != null && v >= FUEL_RANGE.min && v <= FUEL_RANGE.max
    ? { value: v, source: "setting" }
    : { value: FUEL_FALLBACK_L_PER_100KM, source: "default" };
}

export function resolveMarkup(raw: unknown): Assumption {
  const v = settingNumber(raw);
  return v != null && v >= MARKUP_RANGE.min && v <= MARKUP_RANGE.max
    ? { value: v, source: "setting" }
    : { value: LONG_HAUL_FALLBACK_MARKUP, source: "default" };
}
