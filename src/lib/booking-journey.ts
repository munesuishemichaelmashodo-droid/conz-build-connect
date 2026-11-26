// Two customer booking journeys (0183). Con Z arranges transport only; the customer arranges the materials.
//   transport_only       the customer already has the load and needs a truck
//   collect_and_deliver  the driver collects materials the customer arranged at a shop, yard or other place
// The shop or place name is only a collection detail the customer types; Con Z has no supplier accounts.
// Both are priced by the existing transport-only path (customer's collection point -> delivery point).
// The database enforces the same rules (tg_validate_job_kind); this file keeps the screen honest and testable.

export type JobKind = "transport_only" | "collect_and_deliver";
export type TruckRequirement = "any" | "tipper" | "dropside" | "flatbed";
export type PreferredTime = "any" | "morning" | "afternoon";

export type JourneyInput = {
  kind: JobKind | null;
  loadDescription: string;
  loadDetails: string;
  truck: TruckRequirement;
  time: PreferredTime;
  collectionName: string;
  collectionContact: string;
  collectionReference: string;
};

export const EMPTY_JOURNEY: JourneyInput = {
  kind: null,
  loadDescription: "",
  loadDetails: "",
  truck: "any",
  time: "any",
  collectionName: "",
  collectionContact: "",
  collectionReference: "",
};

export const JOURNEYS: { value: JobKind; title: string; body: string }[] = [
  {
    value: "transport_only",
    title: "I have the load, I need a truck",
    body: "Your materials are ready at your yard, site or another place. A driver collects them and delivers.",
  },
  {
    value: "collect_and_deliver",
    title: "Collect materials from a shop",
    body: "You bought or ordered materials from a hardware shop, building-material yard or another place. A driver collects them and delivers to you.",
  },
];

export const TRUCKS: { value: TruckRequirement; label: string }[] = [
  { value: "any", label: "Any suitable truck" },
  { value: "tipper", label: "Tipper" },
  { value: "dropside", label: "Dropside" },
  { value: "flatbed", label: "Flatbed" },
];

export const TIMES: { value: PreferredTime; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
];

export const LIMITS = {
  name: 120,
  contact: 120,
  reference: 80,
  details: 300,
  description: 120,
} as const;

// eslint-disable-next-line no-control-regex -- control characters are exactly what the database refuses
const CONTROL = /[\u0000-\u001f\u007f]/;

/** The first problem with the input, or null when it can be priced and posted. */
export function journeyProblem(j: JourneyInput): string | null {
  if (!j.kind) return "Choose what you need: transport only, or collect materials from a shop.";
  const fields: [string, number, string][] = [
    [j.loadDescription, LIMITS.description, "What you are moving"],
    [j.loadDetails, LIMITS.details, "Load details"],
    [j.collectionName, LIMITS.name, "Shop or collection place name"],
    [j.collectionContact, LIMITS.contact, "Contact at collection"],
    [j.collectionReference, LIMITS.reference, "Order or collection reference"],
  ];
  for (const [v, max, label] of fields) {
    if (v.trim().length > max) return `${label} is too long (${max} characters at most).`;
    if (CONTROL.test(v)) return `${label} has characters that are not allowed.`;
  }
  if (j.kind === "collect_and_deliver" && j.collectionName.trim().length < 2) {
    return "Give the name of the shop or place where the materials are collected.";
  }
  return null;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/**
 * The job columns for this journey. Fields that do not belong to the chosen journey are always sent as null, so
 * switching from "collect" to "transport only" never leaves a hidden shop name, contact or reference behind.
 */
export function journeyJobFields(j: JourneyInput, materialLabel: string) {
  const collect = j.kind === "collect_and_deliver";
  return {
    job_kind: j.kind,
    custom_material: orNull(j.loadDescription) ?? materialLabel,
    load_details: orNull(j.loadDetails),
    truck_requirement: j.truck,
    preferred_time: j.time,
    collection_name: collect ? orNull(j.collectionName) : null,
    collection_contact: collect ? orNull(j.collectionContact) : null,
    collection_reference: collect ? orNull(j.collectionReference) : null,
  };
}

/** Labels for the job page (customer and selected driver). */
export function jobKindLabel(kind: unknown): string | null {
  if (kind === "transport_only") return "Transport only (customer's own load)";
  if (kind === "collect_and_deliver") return "Customer-arranged collection";
  return null;
}

export function truckLabel(t: unknown): string | null {
  return TRUCKS.find((x) => x.value === t && x.value !== "any")?.label ?? null;
}

export function timeLabel(t: unknown): string | null {
  return TIMES.find((x) => x.value === t && x.value !== "any")?.label ?? null;
}

/** Short tag for a driver's job-list card: booking type and truck needed only (never contact or address). */
export function feedJourneyTag(kind: unknown, truck: unknown): string | null {
  const type =
    kind === "transport_only"
      ? "Transport only"
      : kind === "collect_and_deliver"
        ? "Customer-arranged collection"
        : null;
  if (!type) return null;
  const t = truckLabel(truck);
  return t ? `${type} · ${t}` : type;
}
