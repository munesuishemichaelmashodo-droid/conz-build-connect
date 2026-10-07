import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SITE_URL } from "@/lib/site";

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
    const CANONICAL_ORIGIN = SITE_URL;
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

export type InitiateEscrowResult =
  | { ok: true; paymentId: string; redirectUrl: string }
  | { ok: false; error: "paynow_not_configured" | "job_not_found" | "job_not_payable" | "not_your_job" | "already_paid" | string };

/**
 * Con Z Pay — customer pays for a specific job into escrow, held until
 * delivery is confirmed (or auto-released after 72h). Separate from
 * initiatePaynowTopup: this payment is tied to a job (job_id set, type
 * 'escrow') and never credits any wallet directly — see
 * mark_escrow_payment_paid / release_escrow_and_complete.
 */
export const initiateEscrowPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId: string }) => {
    if (!data?.jobId) throw new Error("Missing job");
    return { jobId: data.jobId };
  })
  .handler(async ({ data, context }): Promise<InitiateEscrowResult> => {
    const { getPaynowCredentials, initiatePaynowTransaction } = await import("@/lib/paynow.server");
    const { reconcilePayments } = await import("@/lib/paynow.reconcile.server");
    if (!getPaynowCredentials()) return { ok: false, error: "paynow_not_configured" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: job } = await db
      .from("jobs")
      .select("id,customer_id,payment_method,status,final_price,budget,material")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) return { ok: false, error: "job_not_found" };
    if (job.customer_id !== context.userId) return { ok: false, error: "not_your_job" };
    if (job.payment_method !== "escrow") return { ok: false, error: "job_not_found" };
    // Only a job with a driver on it can be paid for — never a completed
    // or cancelled one.
    if (job.status !== "accepted" && job.status !== "in_progress") return { ok: false, error: "job_not_payable" };

    const { data: previous } = await db
      .from("payments")
      .select("id, status, paynow_poll_url, created_at")
      .eq("job_id", data.jobId)
      .eq("type", "escrow")
      .in("status", ["initiated", "paid", "released", "refund_due", "refunded"]);
    if ((previous ?? []).some((p: { status: string }) => p.status !== "initiated")) {
      return { ok: false, error: "already_paid" };
    }
    // A customer who started a Paynow payment, left, and taps Pay again may
    // actually have completed the first one. Check those attempts with
    // Paynow (verified through apply_paynow_result) before starting another,
    // so they aren't charged twice.
    if ((previous ?? []).length > 0) {
      await reconcilePayments(db, previous, "poll", { deadlineMs: 20_000 });
      const { data: after } = await db
        .from("payments")
        .select("id")
        .eq("job_id", data.jobId)
        .eq("type", "escrow")
        .in("status", ["paid", "released", "refund_due", "refunded"]);
      if ((after ?? []).length > 0) return { ok: false, error: "already_paid" };
    }

    // The amount is the accepted price, read server-side; the client never
    // supplies it. It must be a valid positive amount (audit F1).
    const amount = Number(job.final_price ?? job.budget ?? 0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return { ok: false, error: "job_not_payable" };

    const { data: payment, error } = await db
      .from("payments")
      .insert({
        user_id: context.userId,
        job_id: data.jobId,
        type: "escrow",
        amount,
        currency: "USD",
        method: "paynow",
        status: "initiated",
      })
      .select("id")
      .single();
    if (error || !payment) return { ok: false, error: error?.message ?? "payment_create_failed" };

    const origin = new URL(getRequestUrl()).origin;
    const CANONICAL_ORIGIN = SITE_URL;
    const email = (context.claims as { email?: string })?.email ?? "noreply@conz.co.zw";

    const result = await initiatePaynowTransaction({
      reference: payment.id,
      amount,
      authEmail: email,
      returnUrl: `${origin}/jobs/${data.jobId}`,
      resultUrl: `${CANONICAL_ORIGIN}/api/public/paynow-ipn`,
      additionalInfo: `Con Z Pay — ${job.material} delivery`,
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
    const { reconcilePayments } = await import("@/lib/paynow.reconcile.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: pending } = await db
      .from("payments")
      .select("id, paynow_poll_url, created_at")
      .eq("user_id", context.userId)
      .in("type", ["topup", "escrow"])
      .eq("status", "initiated")
      .not("paynow_poll_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);

    // Every result goes through apply_paynow_result(), which verifies the
    // reference and amount and never credits twice.
    const summary = await reconcilePayments(db, pending ?? [], "poll", { deadlineMs: 20_000 });
    const credited = (summary.applied["credited"] ?? 0) + (summary.applied["escrow_marked_paid"] ?? 0);
    return { checked: summary.checked, credited };
  });
