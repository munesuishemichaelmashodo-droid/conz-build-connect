// Structured cancellation reasons (migration 0148). The categories and who may choose them are enforced by the
// database (cancellation_reason_allowed); this list only decides what each role is shown. Choosing one is optional.

export type CancellationReasonCode =
  | "no_suitable_driver"
  | "no_driver_responded"
  | "price_too_high"
  | "driver_did_not_arrive"
  | "driver_cancelled_after_accepting"
  | "customer_changed_plans"
  | "material_unavailable"
  | "delivery_details_changed"
  | "other";

export type CancellationRole = "customer" | "driver" | "admin";

const LABELS: Record<CancellationReasonCode, string> = {
  no_suitable_driver: "No suitable driver available",
  no_driver_responded: "No driver responded",
  price_too_high: "The price was too high",
  driver_did_not_arrive: "The driver did not arrive",
  driver_cancelled_after_accepting: "The driver cancelled after accepting",
  customer_changed_plans: "I changed my plans",
  material_unavailable: "The material or supplier is unavailable",
  delivery_details_changed: "The delivery details changed",
  other: "Other",
};

const CUSTOMER: CancellationReasonCode[] = [
  "no_suitable_driver",
  "no_driver_responded",
  "price_too_high",
  "driver_did_not_arrive",
  "driver_cancelled_after_accepting",
  "customer_changed_plans",
  "material_unavailable",
  "delivery_details_changed",
  "other",
];
// A driver cannot pick customer-side reasons such as price or "no driver responded" (the database refuses them too).
const DRIVER: CancellationReasonCode[] = ["material_unavailable", "delivery_details_changed", "other"];

export function cancellationReasonOptions(role: CancellationRole): { value: CancellationReasonCode; label: string }[] {
  const codes = role === "driver" ? DRIVER : CUSTOMER;
  return codes.map((value) => ({ value, label: LABELS[value] }));
}

/** Old and unclassified cancellations are shown as unknown. Nothing is guessed. */
export function cancellationReasonLabel(code: string | null | undefined): string {
  if (!code) return "Unknown / not provided";
  return LABELS[code as CancellationReasonCode] ?? "Unknown / not provided";
}
