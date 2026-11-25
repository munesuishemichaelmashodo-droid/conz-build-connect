// Admin recovery for a Linkwa payment-link payment that ConZ never heard about (the customer paid but did not come
// back to ConZ, and no webhook arrived). Server only.
//
// The super admin copies the payment reference from Linkwa's dashboard. Nothing they type is trusted:
//  * the payment must already have a Linkwa link recorded by ConZ (provider_payment_refs.short_url);
//  * ConZ asks Linkwa server to server for THAT link + reference (the adapter refuses an answer about another
//    payment), so a reference from another link, a typo or a made-up value cannot mark this job paid;
//  * the answer goes through apply_provider_link_payment (0175 → 0171) exactly like the customer's return page:
//    same event id ("status:<reference>:<status>"), so a repeat is a duplicate and money is recorded once;
//  * every attempt by a super admin is written to admin_audit_log (who, which payment, which reference, the
//    outcome).
// It never creates, changes or refunds money by itself, and never calls payouts.

import type { ProviderAdapter } from "@/lib/payments/provider.server";

export const PAYMENT_REFERENCE_RE = /^[A-Za-z0-9-]{6,100}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecheckInput = {
  actorId: string;
  paymentId: string;
  paymentReference: string;
  reason: string;
};

export type RecheckResult =
  | {
      ok: true;
      outcome: string;
      reportedStatus: string;
      reportedAmount: number | null;
      reportedCurrency: string | null;
      auditLogged: boolean;
    }
  | {
      ok: false;
      error: "invalid_input" | "forbidden" | "not_found" | "check_failed" | "apply_failed";
    };

type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
export type RecheckDb = {
  rpc(fn: string, args: Record<string, unknown>): Res<unknown>;
  from(table: string): {
    select(cols: string): {
      eq(
        c: string,
        v: string,
      ): { eq(c: string, v: string): { maybeSingle(): Res<Record<string, unknown>> } };
    };
    insert(row: Record<string, unknown>): Res<unknown>;
  };
};

export function validateRecheckInput(i: Partial<RecheckInput>): RecheckInput | null {
  const reason = typeof i.reason === "string" ? i.reason.trim() : "";
  if (
    typeof i.actorId !== "string" ||
    !UUID_RE.test(i.actorId) ||
    typeof i.paymentId !== "string" ||
    !UUID_RE.test(i.paymentId) ||
    typeof i.paymentReference !== "string" ||
    !PAYMENT_REFERENCE_RE.test(i.paymentReference.trim()) ||
    reason.length < 5 ||
    reason.length > 500
  ) {
    return null;
  }
  return {
    actorId: i.actorId,
    paymentId: i.paymentId,
    paymentReference: i.paymentReference.trim(),
    reason,
  };
}

export async function recheckLinkwaPayment(
  db: RecheckDb,
  adapter: ProviderAdapter,
  raw: Partial<RecheckInput>,
): Promise<RecheckResult> {
  const input = validateRecheckInput(raw);
  if (!input) return { ok: false, error: "invalid_input" };

  // Super admins only (0111: the role exists only for the listed owners).
  const { data: isSuper, error: roleError } = await db.rpc("has_role", {
    _user_id: input.actorId,
    _role: "super_admin",
  });
  if (roleError || isSuper !== true) return { ok: false, error: "forbidden" };

  // The link ConZ itself recorded for this payment.
  const { data: refs } = await db
    .from("provider_payment_refs")
    .select("payment_id, short_url")
    .eq("payment_id", input.paymentId)
    .eq("provider", adapter.name)
    .maybeSingle();
  const shortUrl = typeof refs?.short_url === "string" ? refs.short_url : null;
  if (!shortUrl) return { ok: false, error: "not_found" };

  let checked: Awaited<ReturnType<ProviderAdapter["getPaymentStatus"]>>;
  try {
    checked = await adapter.getPaymentStatus(input.paymentId, {
      shortUrl,
      paymentReference: input.paymentReference,
    });
  } catch {
    return { ok: false, error: "check_failed" };
  }

  const { data: outcome, error: applyError } = await db.rpc("apply_provider_link_payment", {
    _provider: adapter.name,
    _event_id: `status:${input.paymentReference}:${checked.status}`,
    _payment_id: input.paymentId,
    _status: checked.status,
    _amount: checked.amount,
    _currency: checked.currency,
    _booking_reference: null,
    _external_payment_link_id: null,
    _short_url: shortUrl,
    _payment_reference: input.paymentReference,
    _receipt_id: checked.link?.receiptId ?? null,
    _source: "status_check",
  });
  if (applyError) return { ok: false, error: "apply_failed" };

  const { error: auditError } = await db.from("admin_audit_log").insert({
    actor_id: input.actorId,
    action: "linkwa_payment_recheck",
    target_id: input.paymentId,
    reason: input.reason,
    meta: {
      payment_reference: input.paymentReference,
      reported_status: checked.status,
      reported_amount: checked.amount,
      reported_currency: checked.currency,
      outcome: String(outcome ?? ""),
    },
  });

  return {
    ok: true,
    outcome: String(outcome ?? ""),
    reportedStatus: checked.status,
    reportedAmount: checked.amount,
    reportedCurrency: checked.currency,
    auditLogged: !auditError,
  };
}
