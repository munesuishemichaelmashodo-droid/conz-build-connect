// Helpers for the homepage price check. Display and navigation only: the price
// itself always comes from computePublicOffer on the server.

export type QuickPriceInput = {
  material: string;
  quantity: number;
  coords: { lat: number; lng: number } | null;
};

/** Identifies the inputs a price was worked out for, so a stale price is never shown. */
export function quickPriceSignature({ material, quantity, coords }: QuickPriceInput): string {
  const where = coords ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}` : "none";
  return `${material}|${quantity}|${where}`;
}

/**
 * The booking screen with the same details filled in. customer.book reads these
 * search params; the sign-in screen only follows same-origin paths (safeInternalPath).
 */
export function quickPriceBookingPath({
  material,
  quantity,
  address,
  coords,
}: QuickPriceInput & { address: string }): string {
  const params = new URLSearchParams({ material, quantity: String(quantity) });
  const trimmed = address.trim().slice(0, 200);
  if (trimmed) params.set("address", trimmed);
  if (coords) {
    params.set("lat", coords.lat.toFixed(6));
    params.set("lng", coords.lng.toFixed(6));
  }
  return `/customer/book?${params.toString()}`;
}

const OFFLINE = "You're offline. Check your connection and try again.";
const UNREACHABLE = "Couldn't reach Con Z. Check your connection and try again.";
const FALLBACK = "Couldn't work out a price just now. Please try again.";

/** Words for a failed price check. Server messages are already written for customers. */
export function quickPriceErrorMessage(error: unknown, offline: boolean): string {
  if (offline) return OFFLINE;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message))
    return UNREACHABLE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return FALLBACK;
}
