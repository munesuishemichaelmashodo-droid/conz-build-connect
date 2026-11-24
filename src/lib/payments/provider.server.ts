// Provider-neutral boundary for provider-collected jobs (0171). Server only.
//
// Rules this enforces before anything reaches the database:
//  1. A callback is accepted only after the adapter verifies its signature (verifyWebhook).
//  2. Its own claims (status, amount, currency) are never used: the payment is re-checked with the provider,
//     server to server (getPaymentStatus), and only that answer is applied.
//  3. apply_provider_payment then checks amount, currency and reference and dedupes on (provider, event id).
//  4. A payout whose result is unclear is resolved only by asking the provider (getPayoutStatus); it is
//     never resent blindly. payout_retry in the database also refuses anything but a confirmed failure.
//
// No provider is approved yet, so PROVIDER_REGISTRY below is EMPTY. The Linkwa SANDBOX adapter is added only by
// getProviderRegistry() (registry.server.ts) when linkwa-config.server.ts allows it: never on the production
// database, never on a production deployment.
//
// Payment-link providers (Linkwa) identify a payment by its link (short URL) and the provider's payment reference,
// not by ConZ's payment id: such events carry `link`, and are applied with apply_provider_link_payment (0175), which
// binds the result to the link ConZ recorded for the payment and stores the identifiers separately.

/** Identifiers a payment-link provider reports. Stored separately in provider_payment_refs (0175). */
export type ProviderLinkRefs = {
  shortUrl: string;
  externalLinkId?: string | null;
  paymentReference?: string | null;
  receiptId?: string | null;
  bookingReference?: string | null;
};

export type VerifiedEvent = { eventId: string; paymentId: string | null; link?: ProviderLinkRefs };

export type ProviderPaymentStatus = {
  status: string; // provider's own word, normalised by the database
  amount: number | null;
  currency: string | null;
  reference: string | null;
  /** Payment-link providers: identifiers from the provider's own status answer. */
  link?: Omit<Partial<ProviderLinkRefs>, "shortUrl" | "paymentReference">;
};

export type ProviderPayoutStatus = {
  status: "paid" | "failed" | "unknown";
  reference: string | null;
  error?: string;
};

export interface ProviderAdapter {
  /** e.g. "linkwa" — must match payments.provider (^[a-z][a-z0-9_]{1,30}$) */
  readonly name: string;
  /** Verify the provider's signature over the RAW body. Return null when it does not verify. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedEvent | null>;
  /** Ask the provider, server to server, for the payment's real status. */
  getPaymentStatus(
    paymentId: string | null,
    link?: ProviderLinkRefs,
  ): Promise<ProviderPaymentStatus>;
  /** Ask the provider for a payout's real status (used for anything sent or unknown). */
  getPayoutStatus(payout: {
    id: string;
    idempotencyKey: string;
    providerReference: string | null;
  }): Promise<ProviderPayoutStatus>;
}

/** Approved adapters only. Empty on purpose (see header); the sandbox registry is in registry.server.ts. */
export const PROVIDER_REGISTRY: Readonly<Record<string, ProviderAdapter>> = Object.freeze({});

type RpcResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
export type ProviderDb = {
  rpc(fn: "provider_collection_enabled", args?: Record<string, never>): RpcResult<boolean>;
  rpc(
    fn: "apply_provider_payment",
    args: {
      _provider: string;
      _event_id: string;
      _payment_id: string;
      _status: string;
      _amount: number | null;
      _currency: string | null;
      _reference: string | null;
      _source: "webhook" | "status_check";
    },
  ): RpcResult<string>;
  rpc(
    fn: "apply_provider_link_payment",
    args: {
      _provider: string;
      _event_id: string;
      _payment_id: string | null;
      _status: string;
      _amount: number | null;
      _currency: string | null;
      _booking_reference: string | null;
      _external_payment_link_id: string | null;
      _short_url: string;
      _payment_reference: string | null;
      _receipt_id: string | null;
      _source: "webhook" | "status_check";
    },
  ): RpcResult<string>;
  rpc(
    fn: "payout_record_result",
    args: {
      _payout_id: string;
      _status: "paid" | "failed" | "unknown";
      _provider_reference: string | null;
      _error: string | null;
    },
  ): RpcResult<unknown>;
};

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });

/** Webhook for /api/payments/webhook/$provider. */
export async function handleProviderWebhook(
  providerName: string,
  rawBody: string,
  headers: Headers,
  db: ProviderDb,
  registry: Readonly<Record<string, ProviderAdapter>> = PROVIDER_REGISTRY,
): Promise<Response> {
  const adapter = Object.prototype.hasOwnProperty.call(registry, providerName)
    ? registry[providerName]
    : undefined;
  if (!adapter) return text("not_found", 404);

  const { data: enabled, error: switchError } = await db.rpc("provider_collection_enabled");
  if (switchError || enabled !== true) return text("not_enabled", 404);

  let event: VerifiedEvent | null = null;
  try {
    event = await adapter.verifyWebhook(rawBody, headers);
  } catch {
    event = null;
  }
  if (!event || !event.eventId || !(event.paymentId || event.link?.shortUrl)) {
    return text("invalid_signature", 401);
  }
  // A verified link event that names no payment cannot be checked or applied (nothing to do; do not retry).
  if (event.link && !event.link.paymentReference) return text("ignored_no_payment", 200);

  let checked: ProviderPaymentStatus;
  try {
    checked = await adapter.getPaymentStatus(event.paymentId, event.link);
  } catch {
    // Provider unreachable: apply nothing; the provider retries the webhook (or a later status check runs).
    return text("status_check_failed", 503);
  }

  // The provider's server-to-server answer wins over the webhook's own claims; the signed webhook fills gaps.
  const { data: outcome, error } = event.link
    ? await db.rpc("apply_provider_link_payment", {
        _provider: adapter.name,
        _event_id: event.eventId,
        _payment_id: event.paymentId,
        _status: checked.status,
        _amount: checked.amount,
        _currency: checked.currency,
        _booking_reference: checked.link?.bookingReference ?? event.link.bookingReference ?? null,
        _external_payment_link_id:
          checked.link?.externalLinkId ?? event.link.externalLinkId ?? null,
        _short_url: event.link.shortUrl,
        _payment_reference: event.link.paymentReference ?? null,
        _receipt_id: checked.link?.receiptId ?? event.link.receiptId ?? null,
        _source: "webhook",
      })
    : await db.rpc("apply_provider_payment", {
        _provider: adapter.name,
        _event_id: event.eventId,
        _payment_id: event.paymentId as string,
        _status: checked.status,
        _amount: checked.amount,
        _currency: checked.currency,
        _reference: checked.reference,
        _source: "webhook",
      });
  if (error) return text("db_error", 502);
  // Duplicates and rejections are still a successful delivery: the provider must not retry them forever.
  return text(String(outcome ?? "ok"), 200);
}

/** Resolve a payout that is sent or unknown by asking the provider. Never resends money. */
export async function resolvePayoutByStatusCheck(
  adapter: ProviderAdapter,
  db: ProviderDb,
  payout: { id: string; idempotencyKey: string; providerReference: string | null },
): Promise<"paid" | "failed" | "unknown"> {
  let result: ProviderPayoutStatus;
  try {
    result = await adapter.getPayoutStatus(payout);
  } catch (e) {
    result = {
      status: "unknown",
      reference: null,
      error: e instanceof Error ? e.message : "status check failed",
    };
  }
  const status = result.status === "paid" || result.status === "failed" ? result.status : "unknown";
  const { error } = await db.rpc("payout_record_result", {
    _payout_id: payout.id,
    _status: status,
    _provider_reference: result.reference,
    _error: result.error ?? null,
  });
  if (error) throw new Error(`payout_record_result failed: ${error.message}`);
  return status;
}
