// Linkwa request/response field mapping, from Linkwa's own documentation (received 24/11/2026):
//   [API]     "Linkwa Developer API" (developer-apps/docs.md)
//   [HOOKS]   "Webhooks Developer Documentation" (webhooks/docs.md)
//   [POSTMAN] Linkwa-Third-Party-API.postman_collection.json
//   [PLUGIN]  Linkwa's WooCommerce plugin (linkwa-payments), used only as evidence of Linkwa's own handling.
// Items marked UNVERIFIED are not stated by the documentation and must be confirmed with a real sandbox response.
//
// Statuses ([POSTMAN] 4b "Payment status: PAID, PENDING, FAILED"; [API] 4 example "PAID"; [PLUGIN] completes an order
// only on "PAID"). Only those three words are mapped. [API] 8's sandbox table lists COMPLETED / CANCELLED / EXPIRED as
// checkout outcomes; "COMPLETED" is NOT treated as paid (it is left unmapped and flagged) until a real status response
// shows which word the status endpoint returns. CANCELLED and EXPIRED are mapped as attempt outcomes: they never move
// money and never close the ConZ payment (0175), so a wrong reading costs nothing.

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
  shortUrl: string | null;
  paymentReference: string | null;
  receiptId: string | null;
  bookingReference: string | null;
  externalLinkId: string | null;
};

export type LinkwaLinkInput = {
  amount: number;
  currency: "USD";
  bookingReference: string;
  name: string;
  description: string;
  returnUrl: string;
};

export type LinkwaCreatedLink = {
  externalLinkId: string;
  shortUrl: string;
  checkoutUrl: string;
  amount: number | null;
  currency: string | null;
};

export interface LinkwaProtocol {
  readEvent(payload: unknown): LinkwaWebhookEvent | null;
  readStatus(body: unknown): LinkwaStatusResult | null;
  linkRequest(input: LinkwaLinkInput): Record<string, unknown>;
  readCreatedLink(body: unknown): LinkwaCreatedLink | null;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const STATUS_MAP: Readonly<Record<string, LinkwaCanonicalStatus>> = Object.freeze({
  PAID: "paid",
  PENDING: "pending",
  FAILED: "failed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

/**
 * The link's short URL from its checkout URL: the last path segment of ".../pay/{short_url}".
 * UNVERIFIED: [API] 3 returns only checkout_url ("https://linkwa.com/pay/b01jxYz"), never short_url; [API] 4 and
 * [POSTMAN] 4b call short_url "your stable reference for the payment link". The adapter therefore checks that every
 * status answer echoes the same short_url before anything is applied.
 */
export function shortUrlFromCheckoutUrl(checkoutUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(checkoutUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const m = /^\/pay\/([A-Za-z0-9_-]{3,64})\/?$/.exec(u.pathname);
  return m ? m[1] : null;
}

export const linkwaProtocol: LinkwaProtocol = {
  // [HOOKS] 1: { event, status, reference, receipt_id, amount, currency, external_payment_link_id, checkout_url, ... }.
  // There is no event id: the event is identified by its type and reference (one completion per payment).
  // UNVERIFIED: that [HOOKS] "reference" is the [API] 4 payment_reference. If it is not, the status check fails
  // (no payment found) and nothing is applied; the customer's return to ConZ still confirms the payment.
  readEvent(payload) {
    const o = obj(payload);
    if (!o || o.event !== "payment.completed") return null;
    const checkoutUrl = str(o.checkout_url);
    const shortUrl = checkoutUrl ? shortUrlFromCheckoutUrl(checkoutUrl) : null;
    const reference = str(o.reference);
    if (!shortUrl || !reference) return null;
    return {
      eventId: `payment.completed:${reference}`,
      eventType: "payment.completed",
      shortUrl,
      paymentReference: reference,
      externalLinkId: str(o.external_payment_link_id),
      receiptId: str(o.receipt_id),
      bookingReference: null, // Linkwa has no merchant reference field
    };
  },

  // [API] 4 / [POSTMAN] 4b: { payment_reference, currency_code, status, short_url, amount, payment_date_time }.
  // [POSTMAN] calls amount "Net amount paid": ConZ requires it to equal the agreed price exactly (0171); any
  // difference is refused and flagged for review, never credited.
  readStatus(body) {
    const o = obj(body);
    const raw = o ? str(o.status) : null;
    if (!o || !raw) return null;
    return {
      status: STATUS_MAP[raw] ?? null,
      rawStatus: raw,
      amount: num(o.amount),
      currency: str(o.currency_code),
      shortUrl: str(o.short_url),
      paymentReference: str(o.payment_reference),
      receiptId: null, // not in the status answer
      bookingReference: null,
      externalLinkId: null,
    };
  },

  // [API] 3 / [POSTMAN] 4. stock 1 = single use ([POSTMAN]: "Defaults to 1 (single-use)"), sent explicitly.
  // Linkwa has no merchant-reference field; ConZ's payment id is put in the description for people only.
  linkRequest(i) {
    return {
      amount: i.amount,
      currency_code: i.currency,
      payment_link_name: i.name,
      description: `${i.description} (ConZ ref ${i.bookingReference})`,
      return_url: i.returnUrl,
      stock: 1,
    };
  },

  // [API] 3: { message, product: { checkout_url, amount, currency_code, qr_code, external_payment_link_id } }.
  readCreatedLink(body) {
    const p = obj(obj(body)?.product);
    const checkoutUrl = p ? str(p.checkout_url) : null;
    const externalLinkId = p ? str(p.external_payment_link_id) : null;
    const shortUrl = checkoutUrl ? shortUrlFromCheckoutUrl(checkoutUrl) : null;
    if (!p || !checkoutUrl || !externalLinkId || !shortUrl) return null;
    return {
      externalLinkId,
      shortUrl,
      checkoutUrl,
      amount: num(p.amount),
      currency: str(p.currency_code),
    };
  },
};

export function getLinkwaProtocol(): LinkwaProtocol | null {
  return linkwaProtocol;
}
