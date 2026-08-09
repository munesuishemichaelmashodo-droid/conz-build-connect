import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InitiateTopupResult =
  | { ok: true; paymentId: string; redirectUrl: string }
  | { ok: false; error: "paynow_not_configured" | string };

export const initiatePaynowTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { amount: number }) => {
    const amount = Number(data?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      throw new Error("Enter a valid amount between $1 and $100,000");
    }
    return { amount: Math.round(amount * 100) / 100 };
  })
  .handler(async ({ data, context }): Promise<InitiateTopupResult> => {
    const { getPaynowCredentials, initiatePaynowTransaction } = await import("@/lib/paynow.server");
    if (!getPaynowCredentials()) return { ok: false, error: "paynow_not_configured" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: payment, error } = await db
      .from("payments")
      .insert({
        user_id: context.userId,
        job_id: null,
        type: "topup",
        amount: data.amount,
        currency: "USD",
        method: "paynow",
        status: "initiated",
      })
      .select("id")
      .single();

    if (error || !payment) return { ok: false, error: error?.message ?? "payment_create_failed" };

    const origin = new URL(getRequestUrl()).origin;
    // resultUrl (Paynow's server-to-server webhook) must always hit the stable
    // production domain — deployment-specific *.vercel.app URLs can be gated by
    // Vercel deployment protection, silently blocking the callback.
    const CANONICAL_ORIGIN = "https://conz-build-connect.vercel.app";
    const email = (context.claims as { email?: string })?.email ?? "noreply@conz.co.zw";

    const result = await initiatePaynowTransaction({
      reference: payment.id,
      amount: data.amount,
      authEmail: email,
      returnUrl: `${origin}/wallet`,
      resultUrl: `${CANONICAL_ORIGIN}/api/public/paynow-ipn`,
      additionalInfo: `Con Z wallet top-up ${payment.id}`,
    });

    if (!result.ok) {
      await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return { ok: false, error: result.error };
    }

    await db
      .from("payments")
      .update({ paynow_poll_url: result.pollUrl, paynow_reference: payment.id })
      .eq("id", payment.id);

    return { ok: true, paymentId: payment.id, redirectUrl: result.browserUrl };
  });

const SUCCESS_STATUSES = new Set(["paid", "awaiting delivery", "delivered"]);
const FAILED_STATUSES = new Set(["cancelled", "failed", "disputed", "refunded"]);

export type ReconcileResult = { checked: number; credited: number };

/**
 * Actively reconcile this user's still-pending Paynow top-ups by polling
 * Paynow directly, rather than waiting on the resultUrl webhook (which is
 * not reliably delivered, especially in test mode). Safe to call anytime —
 * idempotent, only touches this user's own rows.
 */
export const reconcilePendingPaynowPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReconcileResult> => {
    const { pollPaynowStatus } = await import("@/lib/paynow.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: pending } = await db
      .from("payments")
      .select("id, paynow_poll_url")
      .eq("user_id", context.userId)
      .eq("type", "topup")
      .eq("status", "initiated")
      .not("paynow_poll_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    let credited = 0;
    for (const p of pending ?? []) {
      const result = await pollPaynowStatus(p.paynow_poll_url);
      if (!result.ok) continue;
      if (SUCCESS_STATUSES.has(result.status)) {
        // Do NOT pre-set status to "paid" — the RPC uses that as its own
        // idempotency guard and would skip crediting if already set.
        if (result.paynowReference) {
          await db.from("payments").update({ paynow_reference: result.paynowReference }).eq("id", p.id);
        }
        const { error } = await db.rpc("credit_wallet_from_payment", { _payment_id: p.id });
        if (!error) credited += 1;
      } else if (FAILED_STATUSES.has(result.status)) {
        await db.from("payments").update({ status: "failed" }).eq("id", p.id).eq("status", "initiated");
      }
    }
    return { checked: pending?.length ?? 0, credited };
  });
