// The customer's first choice (0183):
//   A. "transport"  Transport only: the customer already has the materials. No material catalogue, no material pricing,
//                   no sourcing. Two collection cases (job_kind):
//                     transport_only       the load is at the customer's own yard, site or another place
//                     collect_and_deliver  the customer bought it at a shop or yard; the driver collects it there
//                   Priced by the transport engine when transport_pricing_enabled is on (pricing_basis transport_only);
//                   otherwise the customer states their own offer and drivers reply (pricing_basis transport_request).
//   B. "materials"  Materials and transport: the existing materials order (catalogue, material pricing, verified
//                   sources, sourcing requests). job_kind stays null.
// The shop or place name is only a collection detail the customer types; Con Z has no supplier accounts.
// The database enforces the same rules (tg_validate_job_kind); this file keeps the screen honest and testable.

export type Service = "transport" | "materials";
export type JobKind = "transport_only" | "collect_and_deliver";
export type TruckRequirement = "any" | "tipper" | "dropside" | "flatbed";
export type PreferredTime = "any" | "morning" | "afternoon";

export type JourneyInput = {
  service: Service | null;
  kind: JobKind;
  loadDescription: string;
  loadDetails: string;
  truck: TruckRequirement;
  time: PreferredTime;
  collectionName: string;
  collectionContact: string;
  collectionReference: string;
};

export const EMPTY_JOURNEY: JourneyInput = {
  service: null,
  kind: "transport_only",
  loadDescription: "",
  loadDetails: "",
  truck: "any",
  time: "any",
  collectionName: "",
  collectionContact: "",
  collectionReference: "",
};

export const SERVICES: { value: Service; title: string; body: string }[] = [
  {
    value: "transport",
    title: "Transport only",
    body: "I already have the materials. A driver collects the load and delivers it.",
  },
  {
    value: "materials",
    title: "Materials and transport",
    body: "I need materials delivered. Choose the material and quantity; we price it and drivers deliver.",
  },
];

/** Where a transport-only load is collected. */
export const JOURNEYS: { value: JobKind; title: string; body: string }[] = [
  {
    value: "transport_only",
    title: "At my yard, site or another place",
    body: "The load is ready where you or someone you know keeps it.",
  },
  {
    value: "collect_and_deliver",
    title: "At a shop or yard where I bought it",
    body: "You paid for or ordered it there. The driver collects it with your order details.",
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
  if (!j.service) return "Choose what you need: transport only, or materials and transport.";
  if (j.service === "materials") return null;
  if (j.loadDescription.trim().length < 2) return "Say what the driver is moving.";
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

/** Highest amount a customer may offer on an unpriced transport request (the platform's job limit). */
export const MAX_REQUEST_OFFER = 100000;

/** The problem with a customer's own offer on an unpriced transport request, or null. */
export function requestOfferProblem(amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0)
    return "Enter the amount you offer drivers for this trip.";
  if (amount > MAX_REQUEST_OFFER)
    return `The most you can offer is $${MAX_REQUEST_OFFER.toLocaleString("en-US")}.`;
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
    return "Use dollars and cents only.";
  return null;
}

/**
 * The job columns for a transport-only booking. Fields that do not belong to the chosen case are always sent as
 * null, so switching from "shop" to "my place" never leaves a hidden shop name, contact or reference behind.
 * Never used for the materials journey (job_kind stays null there).
 */
export function journeyJobFields(j: JourneyInput) {
  const collect = j.kind === "collect_and_deliver";
  return {
    job_kind: j.kind,
    custom_material: j.loadDescription.trim(),
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
