// Linkwa request/response field mapping: the ONLY part of the integration that depends on Linkwa's own documentation.
//
// It is deliberately NOT implemented. Linkwa's developer documentation has not been read yet, so no field name,
// status word or payload shape is written here: none may be guessed. While getLinkwaProtocol() returns null the
// sandbox integration refuses to start (linkwa-config.server.ts -> "protocol_not_documented"), the webhook route
// answers 404 and no request is sent to Linkwa.
//
// To complete it from the documentation, implement LinkwaProtocol:
//  * readEvent:       the signed webhook payload -> event id, event type ("payment.completed"), short_url,
//                     payment_reference, and (if present) the link id, receipt_id and ConZ's booking reference;
//  * readStatus:      the body of GET /payment-links/{short_url}/payments/{payment_reference}/status;
//                     map ONLY documented status words to paid / failed / cancelled / expired / pending. Any other
//                     word (including one that merely looks final, like "COMPLETED") must stay unmapped (null);
//  * linkRequest:     the body of POST /payment-links for one ConZ payment (exact amount, USD, ConZ payment id as
//                     the booking reference if Linkwa supports one, single use if Linkwa supports it);
//  * readCreatedLink: the link id and short_url from POST /payment-links' response.
// Each needs unit tests built from a real sandbox response.

export type LinkwaCanonicalStatus = "paid" | "failed" | "cancelled" | "expired" | "pending";

export type LinkwaWebhookEvent = {
  eventId: string;
  eventType: string;
  shortUrl: string;
  paymentReference: string | null;
  externalLinkId: string | null;
  receiptId: string | null;
  bookingReference: string | null;
};

export type LinkwaStatusResult = {
  /** null when Linkwa's word is not one the documentation maps: it is then recorded as unrecognised, never paid. */
  status: LinkwaCanonicalStatus | null;
  rawStatus: string;
  amount: number | null;
  currency: string | null;
  receiptId: string | null;
  bookingReference: string | null;
  externalLinkId: string | null;
};

export type LinkwaLinkInput = {
  amount: number;
  currency: "USD";
  bookingReference: string;
  description: string;
};

export interface LinkwaProtocol {
  readEvent(payload: unknown): LinkwaWebhookEvent | null;
  readStatus(body: unknown): LinkwaStatusResult | null;
  linkRequest(input: LinkwaLinkInput): Record<string, unknown>;
  readCreatedLink(body: unknown): { externalLinkId: string; shortUrl: string } | null;
}

/** null until the mapping above is written from Linkwa's documentation. */
export function getLinkwaProtocol(): LinkwaProtocol | null {
  return null;
}
