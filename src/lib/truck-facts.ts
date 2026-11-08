/**
 * Facts a driver declares about their truck (migration 0152). They are shown on the
 * customer's offer card labelled as declared by the driver; ConZ checks the registration
 * and capacity, not these.
 */
export type TruckFacts = {
  body_type?: string | null;
  make?: string | null;
  model?: string | null;
  colour?: string | null;
};

export const TRUCK_BODY_TYPES = [
  { value: "tipper", label: "Tipper" },
  { value: "dropside", label: "Dropside" },
  { value: "flatbed", label: "Flatbed" },
  { value: "other", label: "Other" },
] as const;

const clean = (v: string | null | undefined) => (v ?? "").trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "White Isuzu FVZ tipper", or null when the driver gave nothing. */
export function truckFactsLine(facts: TruckFacts | null | undefined): string | null {
  if (!facts) return null;
  const colour = clean(facts.colour);
  const make = clean(facts.make);
  const model = clean(facts.model);
  const body = clean(facts.body_type);
  const bodyWord = body === "other" ? "" : body;
  const alreadyInModel = bodyWord && model.toLowerCase().includes(bodyWord.toLowerCase());
  const parts = [colour, make, model, alreadyInModel ? "" : bodyWord].filter(Boolean);
  if (!parts.length) return null;
  return cap(parts.join(" "));
}
