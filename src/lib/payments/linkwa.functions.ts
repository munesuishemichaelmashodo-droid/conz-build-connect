import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Linkwa SANDBOX: give the customer a payment link for their accepted, provider-paid job. Collection only.
// Available only where linkwa-config.server.ts allows the sandbox (never on the production database). The link is
// for exactly the agreed total (jobs.final_price, via create_provider_job_payment). A browser returning from Linkwa
// proves nothing: the payment counts only after a signed webhook AND a server-to-server status check (0175).

export type StartLinkwaPaymentResult =
  | { ok: true; paymentId: string; shortUrl: string; reused: boolean }
  | {
      ok: false;
      error:
        | "linkwa_sandbox_unavailable"
        | "not_found"
        | "not_payable"
        | "already_paid"
        | "try_again"
        | string;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const startLinkwaSandboxPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId: string }) => {
    if (!data || typeof data.jobId !== "string" || !UUID.test(data.jobId))
      throw new Error("Invalid job");
    return { jobId: data.jobId };
  })
  .handler(async ({ data, context }): Promise<StartLinkwaPaymentResult> => {
    const { linkwaSandboxAdapter } = await import("@/lib/payments/registry.server");
    const adapter = linkwaSandboxAdapter();
    if (!adapter) return { ok: false, error: "linkwa_sandbox_unavailable" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0171/0175 RPCs are not in the generated types yet
    const db = supabaseAdmin as any;

    const { data: job } = await db
      .from("jobs")
      .select("id, customer_id, status, payment_method")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || job.customer_id !== context.userId) return { ok: false, error: "not_found" };
    if (job.payment_method !== "provider" || job.status !== "accepted")
      return { ok: false, error: "not_payable" };

    const { data: payment, error: payError } = await db.rpc("create_provider_job_payment", {
      _job_id: job.id,
      _provider: adapter.name,
      _provider_reference: null,
    });
    if (payError || !payment) return { ok: false, error: "payment_create_failed" };
    if (payment.status !== "initiated") return { ok: false, error: "already_paid" };

    const { data: claim, error: claimError } = await db.rpc("provider_claim_payment_link", {
      _payment_id: payment.id,
      _provider: adapter.name,
    });
    if (claimError) return { ok: false, error: "payment_link_failed" };
    if (claim === "in_progress") return { ok: false, error: "try_again" };
    if (claim === "exists") {
      const { data: refs } = await db
        .from("provider_payment_refs")
        .select("short_url")
        .eq("payment_id", payment.id)
        .maybeSingle();
      if (!refs?.short_url) return { ok: false, error: "try_again" };
      return { ok: true, paymentId: payment.id, shortUrl: refs.short_url, reused: true };
    }

    let link: { externalLinkId: string; shortUrl: string };
    try {
      link = await adapter.createPaymentLink({
        amount: Number(payment.amount),
        bookingReference: payment.id,
        description: `ConZ delivery ${String(job.id).slice(0, 8)}`,
      });
    } catch {
      return { ok: false, error: "payment_link_failed" };
    }
    const { error: recError } = await db.rpc("provider_record_payment_link", {
      _payment_id: payment.id,
      _provider: adapter.name,
      _external_payment_link_id: link.externalLinkId,
      _short_url: link.shortUrl,
    });
    if (recError) return { ok: false, error: "payment_link_failed" };
    return { ok: true, paymentId: payment.id, shortUrl: link.shortUrl, reused: false };
  });
