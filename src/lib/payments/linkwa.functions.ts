import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Linkwa SANDBOX, collection only. Available only where linkwa-config.server.ts allows the sandbox (never on the
// production database, never with a live key).
//  * startLinkwaSandboxPayment: a single-use payment link for exactly the agreed total (jobs.final_price, via
//    create_provider_job_payment) of the customer's accepted, provider-paid job.
//  * verifyLinkwaReturn: Linkwa sends the customer back with ?short_url=&payment_reference=. Those values are only
//    used to ASK Linkwa, server to server, for that payment's status; the redirect itself proves nothing. The
//    answer is applied by apply_provider_link_payment (0175), bound to the link ConZ recorded for the payment.

export type StartLinkwaPaymentResult =
  | { ok: true; paymentId: string; checkoutUrl: string; reused: boolean }
  | { ok: false; error: string };

export type VerifyLinkwaReturnResult =
  | { ok: true; state: "paid" | "pending" | "not_paid" | "needs_review"; jobId: string | null }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_URL = /^[A-Za-z0-9_-]{3,64}$/;
const PAYMENT_REFERENCE = /^[A-Za-z0-9-]{6,100}$/;
export const LINKWA_RETURN_PATH = "/pay/linkwa-return";

/** Whether this server may run the Linkwa SANDBOX (never on the production database). Exposes a boolean only. */
export const linkwaSandboxStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ available: boolean }> => {
    const { linkwaSandboxAdapter } = await import("@/lib/payments/registry.server");
    return { available: linkwaSandboxAdapter() !== null };
  });

export const startLinkwaSandboxPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId: string }) => {
    if (!data || typeof data.jobId !== "string" || !UUID.test(data.jobId)) {
      throw new Error("Invalid job");
    }
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
    if (job.payment_method !== "provider" || job.status !== "accepted") {
      return { ok: false, error: "not_payable" };
    }

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
        .select("checkout_url")
        .eq("payment_id", payment.id)
        .maybeSingle();
      if (!refs?.checkout_url) return { ok: false, error: "try_again" };
      return { ok: true, paymentId: payment.id, checkoutUrl: refs.checkout_url, reused: true };
    }

    let link: { externalLinkId: string; shortUrl: string; checkoutUrl: string };
    try {
      link = await adapter.createPaymentLink({
        amount: Number(payment.amount),
        bookingReference: payment.id,
        name: "ConZ delivery",
        description: `ConZ delivery ${String(job.id).slice(0, 8)}`,
        returnUrl: `${new URL(getRequestUrl()).origin}${LINKWA_RETURN_PATH}`,
      });
    } catch {
      return { ok: false, error: "payment_link_failed" };
    }
    const { error: recError } = await db.rpc("provider_record_payment_link", {
      _payment_id: payment.id,
      _provider: adapter.name,
      _external_payment_link_id: link.externalLinkId,
      _short_url: link.shortUrl,
      _checkout_url: link.checkoutUrl,
    });
    if (recError) return { ok: false, error: "payment_link_failed" };
    return { ok: true, paymentId: payment.id, checkoutUrl: link.checkoutUrl, reused: false };
  });

export const verifyLinkwaReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { shortUrl: string; paymentReference: string }) => {
    if (
      !data ||
      typeof data.shortUrl !== "string" ||
      !SHORT_URL.test(data.shortUrl) ||
      typeof data.paymentReference !== "string" ||
      !PAYMENT_REFERENCE.test(data.paymentReference)
    ) {
      throw new Error("Invalid payment details");
    }
    return { shortUrl: data.shortUrl, paymentReference: data.paymentReference };
  })
  .handler(async ({ data, context }): Promise<VerifyLinkwaReturnResult> => {
    const { linkwaSandboxAdapter } = await import("@/lib/payments/registry.server");
    const adapter = linkwaSandboxAdapter();
    if (!adapter) return { ok: false, error: "linkwa_sandbox_unavailable" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0171/0175 RPCs are not in the generated types yet
    const db = supabaseAdmin as any;

    // Only the customer who owns the payment behind this link may ask about it.
    const { data: refs } = await db
      .from("provider_payment_refs")
      .select("payment_id")
      .eq("provider", adapter.name)
      .eq("short_url", data.shortUrl)
      .maybeSingle();
    if (!refs?.payment_id) return { ok: false, error: "not_found" };
    const { data: payment } = await db
      .from("payments")
      .select("id, user_id, job_id")
      .eq("id", refs.payment_id)
      .maybeSingle();
    if (!payment || payment.user_id !== context.userId) return { ok: false, error: "not_found" };

    let checked: Awaited<ReturnType<typeof adapter.getPaymentStatus>>;
    try {
      checked = await adapter.getPaymentStatus(payment.id, {
        shortUrl: data.shortUrl,
        paymentReference: data.paymentReference,
      });
    } catch {
      return { ok: false, error: "check_failed" };
    }

    const { data: outcome, error } = await db.rpc("apply_provider_link_payment", {
      _provider: adapter.name,
      _event_id: `status:${data.paymentReference}:${checked.status}`,
      _payment_id: payment.id,
      _status: checked.status,
      _amount: checked.amount,
      _currency: checked.currency,
      _booking_reference: null,
      _external_payment_link_id: null,
      _short_url: data.shortUrl,
      _payment_reference: data.paymentReference,
      _receipt_id: checked.link?.receiptId ?? null,
      _source: "status_check",
    });
    if (error) return { ok: false, error: "apply_failed" };

    const { data: after } = await db
      .from("payments")
      .select("status")
      .eq("id", payment.id)
      .maybeSingle();
    const o = String(outcome ?? "");
    const state: "paid" | "pending" | "not_paid" | "needs_review" =
      after?.status === "paid" || after?.status === "released"
        ? "paid"
        : o.startsWith("attempt_") ||
            (o === "duplicate" && ["failed", "cancelled", "expired"].includes(checked.status))
          ? "not_paid"
          : o === "pending_no_change" || (o === "duplicate" && checked.status === "pending")
            ? "pending"
            : "needs_review";
    return { ok: true, state, jobId: payment.job_id ?? null };
  });

export type AdminOpenLinkwaPayment = {
  paymentId: string;
  jobId: string | null;
  amount: number;
  currency: string;
  createdAt: string;
  shortUrl: string;
};

/** Super admin: Linkwa payments with a link that are still waiting for money (recovery list). Sandbox only. */
export const adminListOpenLinkwaPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ ok: true; rows: AdminOpenLinkwaPayment[] } | { ok: false; error: string }> => {
      const { linkwaSandboxAdapter } = await import("@/lib/payments/registry.server");
      const adapter = linkwaSandboxAdapter();
      if (!adapter) return { ok: false, error: "linkwa_sandbox_unavailable" };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0171/0175 tables are not in the generated types yet
      const db = supabaseAdmin as any;
      const { data: isSuper } = await db.rpc("has_role", {
        _user_id: context.userId,
        _role: "super_admin",
      });
      if (isSuper !== true) return { ok: false, error: "forbidden" };
      const { data: pays } = await db
        .from("payments")
        .select("id, job_id, amount, currency, created_at")
        .eq("provider", adapter.name)
        .eq("type", "job_payment")
        .eq("status", "initiated")
        .order("created_at", { ascending: false })
        .limit(50);
      const ids = ((pays ?? []) as { id: string }[]).map((p) => p.id);
      if (ids.length === 0) return { ok: true, rows: [] };
      const { data: refs } = await db
        .from("provider_payment_refs")
        .select("payment_id, short_url")
        .in("payment_id", ids);
      const shortBy = new Map<string, string>(
        ((refs ?? []) as { payment_id: string; short_url: string | null }[])
          .filter((r) => r.short_url)
          .map((r) => [r.payment_id, r.short_url as string]),
      );
      const rows = (
        (pays ?? []) as {
          id: string;
          job_id: string | null;
          amount: number | string;
          currency: string;
          created_at: string;
        }[]
      )
        .filter((p) => shortBy.has(p.id))
        .map((p) => ({
          paymentId: p.id,
          jobId: p.job_id,
          amount: Number(p.amount),
          currency: p.currency,
          createdAt: p.created_at,
          shortUrl: shortBy.get(p.id) as string,
        }));
      return { ok: true, rows };
    },
  );

/** Super admin: re-check one Linkwa payment by the reference shown in Linkwa's dashboard (see linkwa-recheck.server.ts). */
export const adminRecheckLinkwaPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string; paymentReference: string; reason: string }) => {
    if (
      !data ||
      typeof data.paymentId !== "string" ||
      !UUID.test(data.paymentId) ||
      typeof data.paymentReference !== "string" ||
      !PAYMENT_REFERENCE.test(data.paymentReference.trim()) ||
      typeof data.reason !== "string" ||
      data.reason.trim().length < 5 ||
      data.reason.length > 500
    ) {
      throw new Error("Invalid re-check request");
    }
    return {
      paymentId: data.paymentId,
      paymentReference: data.paymentReference.trim(),
      reason: data.reason.trim(),
    };
  })
  .handler(async ({ data, context }) => {
    const { linkwaSandboxAdapter } = await import("@/lib/payments/registry.server");
    const adapter = linkwaSandboxAdapter();
    if (!adapter) return { ok: false as const, error: "linkwa_sandbox_unavailable" };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recheckLinkwaPayment } = await import("@/lib/payments/linkwa-recheck.server");
    return recheckLinkwaPayment(supabaseAdmin as never, adapter, {
      ...data,
      actorId: context.userId,
    });
  });
