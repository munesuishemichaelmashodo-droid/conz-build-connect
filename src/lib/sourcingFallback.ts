import type { MaterialSourceResolution } from "@/lib/materialSource.functions";

/**
 * Nationwide-sourcing fallback.
 *
 * "No supplier can serve this order" and "we failed to find out" are
 * different outcomes and must never share a code path:
 *
 *   no_supply  -> nothing configured / nothing eligible for this order. The
 *                 customer's request is PERSISTED as a sourcing request and
 *                 the response says "awaiting sourcing" -- never a quote.
 *   failure    -> infrastructure problem (existence check, candidates RPC,
 *                 every route lookup failed). A controlled, retryable error:
 *                 recording a sourcing request here would tell the customer
 *                 "no supplier" when the truth is "we couldn't check".
 */
export type SourcingReason = "no_source_configured" | "no_eligible_source";

export type ResolutionOutcome =
  | { kind: "resolved" }
  | { kind: "no_supply"; reason: SourcingReason }
  | { kind: "failure"; reason: string };

export function classifyResolution(resolution: MaterialSourceResolution): ResolutionOutcome {
  if (resolution.status === "source_resolved") return { kind: "resolved" };
  if (resolution.status === "no_source_configured") {
    return { kind: "no_supply", reason: "no_source_configured" };
  }
  if (resolution.reason === "no_eligible_source") {
    return { kind: "no_supply", reason: "no_eligible_source" };
  }
  return { kind: "failure", reason: resolution.reason };
}

export type AwaitingSourcingResult = {
  status: "awaiting_sourcing";
  // null only for an anonymous visitor: nothing is stored without an account.
  sourcingRequestId: string | null;
  requiresSignIn: boolean;
  reason: SourcingReason;
  material: string;
  quantity: number;
  message: string;
};

export const AWAITING_SOURCING_MESSAGE =
  "We don't have a verified supplier for this order yet. We've recorded your request and our team " +
  "is finding one. You'll be notified with a confirmed quote — nothing is booked or charged until you accept it.";

export const SIGN_IN_TO_REQUEST_MESSAGE =
  "We don't have a verified supplier for this order yet. Sign in or create an account and we'll " +
  "source it for you — we can't give a price until a supplier is confirmed.";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export type SourcingFallbackInput = {
  material: string;
  quantity: number;
  deliveryLat: number;
  deliveryLng: number;
  address?: string;
  idempotencyKey?: string;
};

/** Address text stored with a request. Never invent one: fall back to the pin itself. */
export function sourcingAddress(input: SourcingFallbackInput): string {
  const a = input.address?.trim();
  if (a) return a.slice(0, 500);
  return `Pin ${input.deliveryLat.toFixed(5)}, ${input.deliveryLng.toFixed(5)}`;
}

export async function createSourcingFallback(
  sb: RpcClient,
  input: SourcingFallbackInput,
  reason: SourcingReason,
): Promise<AwaitingSourcingResult> {
  const { data, error } = await sb.rpc("create_material_sourcing_request", {
    p_material: input.material,
    p_custom_material: null,
    p_quantity_m3: input.quantity,
    p_delivery_address: sourcingAddress(input),
    p_delivery_lat: input.deliveryLat,
    p_delivery_lng: input.deliveryLng,
    p_preferred_date: null,
    p_notes: null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });

  if (error) {
    if (error.code === "54000" || /too many/i.test(error.message)) {
      throw new Error(
        "You have too many open sourcing requests right now. Please try again later.",
      );
    }
    if (/only customer accounts/i.test(error.message)) {
      throw new Error("Only customer accounts can request sourcing.");
    }
    // Never report "awaiting sourcing" unless the request really was stored.
    throw new Error("We couldn't record your sourcing request. Please try again in a moment.");
  }
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("We couldn't record your sourcing request. Please try again in a moment.");
  }

  return {
    status: "awaiting_sourcing",
    sourcingRequestId: data,
    requiresSignIn: false,
    reason,
    material: input.material,
    quantity: input.quantity,
    message: AWAITING_SOURCING_MESSAGE,
  };
}

export function anonymousAwaitingSourcing(
  input: SourcingFallbackInput,
  reason: SourcingReason,
): AwaitingSourcingResult {
  return {
    status: "awaiting_sourcing",
    sourcingRequestId: null,
    requiresSignIn: true,
    reason,
    material: input.material,
    quantity: input.quantity,
    message: SIGN_IN_TO_REQUEST_MESSAGE,
  };
}

export function isAwaitingSourcing(r: { status: string }): r is AwaitingSourcingResult {
  return r.status === "awaiting_sourcing";
}
