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
