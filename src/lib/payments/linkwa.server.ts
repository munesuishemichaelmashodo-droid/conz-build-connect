// Linkwa SANDBOX adapter (collection only). Server only. Built only from linkwa-config.server.ts, which refuses the
// production database, production deployments, live keys and any non-sandbox Linkwa host.
//
// Endpoints used (Linkwa Developer API): POST /payment-links and
// GET /payment-links/{short_url}/payments/{payment_reference}/status. Nothing else: no payouts, users, wallets,
// balance or statement (Linkwa forbids polling those). Webhooks: X-Linkwa-Signature = hex HMAC-SHA256 of the raw
// body (hmac.server.ts). Field names come only from linkwa-protocol.ts.

import type {
  ProviderAdapter,
  ProviderLinkRefs,
  ProviderPaymentStatus,
} from "@/lib/payments/provider.server";
import { verifyHmacSha256 } from "@/lib/payments/hmac.server";
import type { LinkwaSandboxConfig } from "@/lib/payments/linkwa-config.server";
import type { LinkwaCreatedLink } from "@/lib/payments/linkwa-protocol";

export const LINKWA_PROVIDER = "linkwa";
export const LINKWA_SIGNATURE_HEADER = "x-linkwa-signature";
const TIMEOUT_MS = 15_000;

export type LinkwaAdapter = ProviderAdapter & {
  createPaymentLink(input: {
    amount: number;
    bookingReference: string;
    name: string;
    description: string;
    returnUrl: string;
  }): Promise<LinkwaCreatedLink>;
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function createLinkwaAdapter(
  cfg: LinkwaSandboxConfig,
  fetchImpl: FetchLike = fetch,
): LinkwaAdapter {
  const { protocol } = cfg;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function readJson(res: Response, what: string): Promise<unknown> {
    // Only the status code is reported: response bodies may carry customer details.
    if (!res.ok) throw new Error(`Linkwa ${what} failed with HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new Error(`Linkwa ${what} returned a body that is not JSON`);
    }
  }

  return {
    name: LINKWA_PROVIDER,

    async verifyWebhook(rawBody, hdrs) {
      const ok = await verifyHmacSha256(
        rawBody,
        hdrs.get(LINKWA_SIGNATURE_HEADER),
        cfg.webhookSecret,
        cfg.signatureEncoding,
      );
      if (!ok) return null;
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const ev = protocol.readEvent(payload);
      if (!ev || !ev.eventId || !ev.shortUrl) return null;
      const link: ProviderLinkRefs = {
        shortUrl: ev.shortUrl,
        externalLinkId: ev.externalLinkId,
        paymentReference: ev.paymentReference,
        receiptId: ev.receiptId,
        bookingReference: ev.bookingReference,
      };
      return { eventId: ev.eventId, paymentId: null, link };
    },

    async getPaymentStatus(_paymentId, link): Promise<ProviderPaymentStatus> {
      if (!link?.shortUrl || !link.paymentReference) {
        throw new Error("Linkwa status needs the short URL and the payment reference");
      }
      const url =
        `${cfg.baseUrl}/payment-links/${encodeURIComponent(link.shortUrl)}` +
        `/payments/${encodeURIComponent(link.paymentReference)}/status`;
      const res = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const r = protocol.readStatus(await readJson(res, "status check"));
      if (!r) throw new Error("Linkwa status answer could not be read");
      // The answer must be about the payment that was asked for.
      if (r.shortUrl !== link.shortUrl || r.paymentReference !== link.paymentReference) {
        throw new Error("Linkwa status answer is for a different payment");
      }
      return {
        // An unmapped word is passed on marked as unrecognised: the database flags it and never treats it as paid.
        status: r.status ?? `unrecognised:${r.rawStatus}`,
        amount: r.amount,
        currency: r.currency,
        reference: null, // link identifiers never go into payments.provider_reference (0175)
        link: {
          receiptId: r.receiptId,
          bookingReference: r.bookingReference,
          externalLinkId: r.externalLinkId,
        },
      };
    },

    async getPayoutStatus() {
      // Payouts are not implemented for Linkwa. Never "paid".
      return { status: "unknown", reference: null, error: "Linkwa payouts are not implemented" };
    },

    async createPaymentLink({ amount, bookingReference, name, description, returnUrl }) {
      if (!(Number.isFinite(amount) && amount > 0 && amount <= 100_000)) {
        throw new Error("Invalid amount");
      }
      const rounded = Math.round(amount * 100) / 100;
      const res = await fetchImpl(`${cfg.baseUrl}/payment-links`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          protocol.linkRequest({
            amount: rounded,
            currency: "USD",
            bookingReference,
            name,
            description,
            returnUrl,
          }),
        ),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const link = protocol.readCreatedLink(await readJson(res, "payment link"));
      if (!link) throw new Error("Linkwa payment link answer could not be read");
      // The link must be for exactly the agreed price, in USD.
      if (link.amount !== rounded || link.currency !== "USD") {
        throw new Error("Linkwa created a payment link for a different amount or currency");
      }
      return link;
    },
  };
}
