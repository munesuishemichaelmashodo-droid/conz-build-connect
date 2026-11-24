// Linkwa SANDBOX adapter (collection only). Server only. Built only from linkwa-config.server.ts, which refuses the
// production database, production deployments and any non-sandbox Linkwa host.
//
// Endpoints used (as listed for the ConZ sandbox app): POST /payment-links and
// GET /payment-links/{short_url}/payments/{payment_reference}/status. Nothing else: no payouts, users or wallets.
// Webhooks: X-Linkwa-Signature, HMAC-SHA256 over the raw body (hmac.server.ts). Field names come only from
// linkwa-protocol.ts, which is filled in from Linkwa's documentation.

import type {
  ProviderAdapter,
  ProviderLinkRefs,
  ProviderPaymentStatus,
} from "@/lib/payments/provider.server";
import { verifyHmacSha256 } from "@/lib/payments/hmac.server";
import type { LinkwaSandboxConfig } from "@/lib/payments/linkwa-config.server";

export const LINKWA_PROVIDER = "linkwa";
export const LINKWA_SIGNATURE_HEADER = "x-linkwa-signature";
const TIMEOUT_MS = 10_000;

export type LinkwaAdapter = ProviderAdapter & {
  createPaymentLink(input: {
    amount: number;
    bookingReference: string;
    description: string;
  }): Promise<{ externalLinkId: string; shortUrl: string }>;
};

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function createLinkwaAdapter(
  cfg: LinkwaSandboxConfig,
  fetchImpl: FetchLike = fetch,
): LinkwaAdapter {
  const { protocol } = cfg;
  const headers = (json: boolean): Record<string, string> => ({
    Authorization: `Bearer ${cfg.apiKey}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  });

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
        headers: headers(false),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const r = protocol.readStatus(await readJson(res, "status check"));
      if (!r) throw new Error("Linkwa status answer could not be read");
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
      // Payouts are not implemented for Linkwa (no documented payout status). Never "paid".
      return { status: "unknown", reference: null, error: "Linkwa payouts are not implemented" };
    },

    async createPaymentLink({ amount, bookingReference, description }) {
      if (!(Number.isFinite(amount) && amount > 0 && amount <= 100_000))
        throw new Error("Invalid amount");
      const res = await fetchImpl(`${cfg.baseUrl}/payment-links`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify(
          protocol.linkRequest({
            amount: Math.round(amount * 100) / 100,
            currency: "USD",
            bookingReference,
            description,
          }),
        ),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const link = protocol.readCreatedLink(await readJson(res, "payment link"));
      if (!link || !link.externalLinkId || !link.shortUrl)
        throw new Error("Linkwa payment link answer could not be read");
      return link;
    },
  };
}
