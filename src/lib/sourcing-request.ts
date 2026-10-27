import { z } from "zod";

/**
 * Optional "ask Con Z for a confirmed quote" request, offered next to an open request when no
 * listed supplier covers the delivery point. It records a material_sourcing_request (0087/0088);
 * an admin finds a verified supplier and issues an engine-priced quote. Nothing here creates a
 * price or a supplier response.
 *
 * Off unless the setting `sourcing_requests_enabled` is exactly true: someone has to answer the
 * requests, so the owner switches it on (14/10/2026 decision made open requests the default).
 */
export const SOURCING_SWITCH_KEY = "sourcing_requests_enabled";

export function sourcingRequestsEnabledFrom(value: unknown): boolean {
  return value === true;
}

export const MAX_SOURCING_NOTE = 500;

/** Materials a customer can price or request (same list the price check accepts). */
export const BOOKING_MATERIALS = [
  "river_sand",
  "pit_sand",
  "quarry_dust",
  "crusher_run",
  "gravel",
  "stones",
  "top_soil",
  "filling_soil",
  "custom",
] as const;

// "custom" needs a material name the request form doesn't collect, so it can't be requested.
const REQUESTABLE = BOOKING_MATERIALS.filter((m) => m !== "custom") as unknown as [
  string,
  ...string[],
];

const todayIso = () => new Date().toISOString().slice(0, 10);

export const SourcingRequestInput = z.object({
  material: z.enum(REQUESTABLE),
  quantity: z.number().positive("Enter a quantity").max(50, "For more than 50 m³, contact us"),
  // Same bounds as a price check: Zimbabwe only.
  deliveryLat: z.number().finite().min(-23).max(-15),
  deliveryLng: z.number().finite().min(25).max(33.5),
  address: z.string().trim().max(200).optional(),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date")
    .refine((d) => d >= todayIso(), "Choose today or a later date")
    .optional(),
  notes: z
    .string()
    .trim()
    .max(MAX_SOURCING_NOTE, `Keep the note under ${MAX_SOURCING_NOTE} characters`)
    .optional(),
  idempotencyKey: z.string().min(8).max(128),
});

export type SourcingRequestInputT = z.infer<typeof SourcingRequestInput>;

export function parseSourcingRequestInput(input: unknown): SourcingRequestInputT {
  const r = SourcingRequestInput.safeParse(input);
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Check the request details");
  return r.data;
}

/** The refusal shown when a listed supplier already covers the order. */
export const SUPPLIER_COVERS_MESSAGE =
  "A listed supplier covers this delivery point, so you can book with the price shown. Go back and check the price again.";

type SourcingRow = {
  customer_id: string;
  status: string;
  quote_id: string | null;
  supply_location_id: string | null;
  quote_valid_until: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};
type QuoteRow = {
  customer_id: string | null;
  consumed_at: string | null;
  supply_location_id: string | null;
  expires_at: string;
  distance_source: string | null;
};

/** Why an admin-issued sourcing quote can't be booked, or null when it can. */
export function sourcingRequestProblem(
  req: SourcingRow | null,
  userId: string,
  now = Date.now(),
): string | null {
  if (!req || req.customer_id !== userId) return "Sourcing request not found.";
  if (
    req.status !== "quote_ready" ||
    !req.quote_id ||
    !req.supply_location_id ||
    !req.quote_valid_until
  ) {
    return "This sourcing request doesn't have an active quote.";
  }
  if (new Date(req.quote_valid_until).getTime() <= now)
    return "This quote has expired. Please request sourcing again.";
  if (req.delivery_lat == null || req.delivery_lng == null) {
    return "This request has no delivery pin, so it can't be booked.";
  }
  return null;
}

export function sourcingQuoteProblem(
  quote: QuoteRow | null,
  req: Pick<SourcingRow, "supply_location_id">,
  userId: string,
  now = Date.now(),
): string | null {
  if (
    !quote ||
    quote.customer_id !== userId ||
    quote.consumed_at ||
    quote.supply_location_id !== req.supply_location_id ||
    new Date(quote.expires_at).getTime() <= now ||
    quote.distance_source !== "osrm"
  ) {
    return "This quote is no longer valid. Please request sourcing again.";
  }
  return null;
}
