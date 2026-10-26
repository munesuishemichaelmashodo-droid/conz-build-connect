import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Con Z Pay through Payonify (EcoCash, SANDBOX ONLY). Off for everyone unless the server has
// PAYONIFY_MODE=test, test keys, a non-production database and the user is a listed tester
// (see payonify.process.server.ts). Paynow stays the payment option for everyone else.
//
// The browser never decides a payment is paid: these functions only start a charge or ask
// Payonify for its status; the state change happens in apply_payonify_charge (migration 0120).

export type PayonifyPaymentState = "pending" | "paid" | "failed" | "cancelled" | "unknown";

export type PayonifyStartResult =
  | { ok: true; paymentId: string; state: PayonifyPaymentState; resumed?: boolean }
  | { ok: false; error: PayonifyStartError; paymentId?: string };

export type PayonifyStartError =
  | "payonify_unavailable"
  | "escrow_unavailable"
  | "job_not_found"
  | "not_your_job"
  | "job_not_payable"
  | "already_paid"
  | "other_payment_open"
  | "previous_attempt_unclear"
  | "invalid_number"
  | "payment_declined"
  | "payment_status_unknown"
  | "payment_create_failed";

function stateOf(status: string | null | undefined): PayonifyPaymentState {
  if (status === "initiated") return "pending";
  if (
    status === "paid" ||
    status === "released" ||
    status === "refund_due" ||
    status === "refunded"
  )
    return "paid";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "unknown";
}

/** Whether to show the Payonify option to this user. Reveals nothing else. */
export const payonifyAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ available: boolean }> => {
    const { payonifyGateFor } = await import("@/lib/payonify.process.server");
    return { available: payonifyGateFor(process.env, context.userId).ok };
  });

type PrevRow = {
  id: string;
  status: string;
  method: string | null;
  provider: string | null;
  provider_reference: string | null;
  created_at: string;
};

export const initiatePayonifyEscrowPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId: string; mobileNumber: string }) => {
    if (!data?.jobId || typeof data.jobId !== "string") throw new Error("Missing job");
    if (typeof data.mobileNumber !== "string" || data.mobileNumber.length > 20)
      throw new Error("Enter a valid EcoCash number");
    return { jobId: data.jobId, mobileNumber: data.mobileNumber };
  })
  .handler(async ({ data, context }): Promise<PayonifyStartResult> => {
    const { payonifyGateFor, applyPayonifyCharge } = await import("@/lib/payonify.process.server");
    const {
      chargeFacts,
      createEcocashCharge,
      getCharge,
      isDefinitiveRejection,
      toEcocashNumber,
      toMinorUnits,
      PayonifyError,
    } = await import("@/lib/payonify.server");

    const gate = payonifyGateFor(process.env, context.userId);
    if (!gate.ok) return { ok: false, error: "payonify_unavailable" };

    let mobileNumber: string;
    try {
      mobileNumber = toEcocashNumber(data.mobileNumber);
    } catch {
      return { ok: false, error: "invalid_number" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role RPCs/columns added by 0073+/0120 are not in the generated types yet
    const db = supabaseAdmin as any;

    // Same rules as the Paynow escrow path (paynow.functions.ts initiateEscrowPayment).
    const { data: switches } = await db.rpc("launch_switches");
    if (!(switches as { escrowEnabled?: boolean } | null)?.escrowEnabled) {
      return { ok: false, error: "escrow_unavailable" };
    }

    const { data: job } = await db
      .from("jobs")
      .select("id,customer_id,payment_method,status,final_price,budget,material")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job) return { ok: false, error: "job_not_found" };
    if (job.customer_id !== context.userId) return { ok: false, error: "not_your_job" };
    if (job.payment_method !== "escrow") return { ok: false, error: "job_not_found" };
    if (job.status !== "accepted" && job.status !== "in_progress")
      return { ok: false, error: "job_not_payable" };

    const loadPrevious = async (): Promise<PrevRow[]> => {
      const { data: rows } = await db
        .from("payments")
        .select("id,status,method,provider,provider_reference,created_at")
        .eq("job_id", data.jobId)
        .eq("type", "escrow")
        .in("status", ["initiated", "paid", "released", "refund_due", "refunded"])
        .order("created_at", { ascending: false });
      return (rows ?? []) as PrevRow[];
    };

    let previous = await loadPrevious();
    if (previous.some((p) => p.status !== "initiated")) return { ok: false, error: "already_paid" };

    // One open attempt per job, across providers: never start a second charge while another
    // may still be paid. Open Paynow attempts are left to Paynow's own checks and expiry.
    if (previous.some((p) => p.provider !== "payonify"))
      return { ok: false, error: "other_payment_open" };

    // An open Payonify attempt: ask Payonify how it stands before doing anything else.
    for (const p of previous) {
      if (!p.provider_reference) continue;
      try {
        const facts = chargeFacts(await getCharge(gate.cfg, p.provider_reference));
        await applyPayonifyCharge(db, p.id, "poll", null, facts);
      } catch {
        /* Payonify unreachable: the attempt stays open and blocks a new one below. */
      }
    }
    previous = await loadPrevious();
    if (previous.some((p) => p.status !== "initiated")) return { ok: false, error: "already_paid" };
    const open = previous[0];
    if (open) {
      // Still waiting for the customer to approve on their phone: show that attempt again.
      if (open.provider_reference)
        return { ok: true, paymentId: open.id, state: "pending", resumed: true };
      // We never learned whether Payonify created a charge for it. An admin checks it.
      return { ok: false, error: "previous_attempt_unclear", paymentId: open.id };
    }

    // The amount is the accepted price, read server-side; the client never supplies it.
    const amount = Number(job.final_price ?? job.budget ?? 0);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000)
      return { ok: false, error: "job_not_payable" };
    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(amount);
    } catch {
      return { ok: false, error: "job_not_payable" };
    }
    if (amountMinor < 100) return { ok: false, error: "job_not_payable" };

    // Record the attempt BEFORE calling Payonify, so a crash mid-call leaves a trace.
    const { data: payment, error } = await db
      .from("payments")
      .insert({
        user_id: context.userId,
        job_id: data.jobId,
        type: "escrow",
        amount,
        currency: "USD",
        method: "payonify",
        status: "initiated",
        provider: "payonify",
        provider_livemode: false,
      })
      .select("id")
      .single();
    if (error?.code === "23505") return { ok: false, error: "other_payment_open" }; // a parallel tap won
    if (error || !payment) return { ok: false, error: "payment_create_failed" };

    try {
      const charge = await createEcocashCharge(gate.cfg, {
        amountMinor,
        currency: "usd",
        mobileNumber,
        description: `Con Z Pay - ${String(job.material ?? "material").slice(0, 40)} delivery`,
        metadata: { conz_payment_id: payment.id, job_id: data.jobId },
      });
      const facts = chargeFacts(charge);
      // The charge we just created is ours: keep its id even if a check below rejects the
      // reply, so a status check or an admin can always find it at Payonify.
      if (facts.id) {
        await db.from("payments").update({ provider_reference: facts.id }).eq("id", payment.id);
      }
      const applied = await applyPayonifyCharge(db, payment.id, "initiate", null, facts);
      if (!applied.ok) return { ok: false, error: "payment_status_unknown", paymentId: payment.id };
      return { ok: true, paymentId: payment.id, state: stateOf(applied.status) };
    } catch (err) {
      if (isDefinitiveRejection(err)) {
        // Payonify answered and refused: nothing was created, so the attempt is closed.
        await db.from("payments").update({ status: "failed" }).eq("id", payment.id);
        await db.rpc("record_payment_event", {
          _payment_id: payment.id,
          _source: "initiate",
          _outcome: "provider_rejected",
          _detail: err instanceof PayonifyError ? `${err.status} ${err.code ?? ""}`.trim() : null,
        });
        return { ok: false, error: "payment_declined", paymentId: payment.id };
      }
      // Unclear (timeout, 5xx): the charge may exist. Keep the attempt open; a status check
      // or the webhook settles it. Never retry the charge blindly.
      await db.rpc("record_payment_event", {
        _payment_id: payment.id,
        _source: "initiate",
        _outcome: "initiate_unclear",
        _detail:
          err instanceof PayonifyError
            ? `${err.status} ${err.code ?? ""}`.trim()
            : "unexpected error",
      });
      return { ok: false, error: "payment_status_unknown", paymentId: payment.id };
    }
  });

/** "Check status": asks Payonify about this customer's own payment and applies the answer. */
export const refreshPayonifyPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => {
    if (!data?.paymentId || typeof data.paymentId !== "string") throw new Error("Missing payment");
    return { paymentId: data.paymentId };
  })
  .handler(
    async ({ data, context }): Promise<{ state: PayonifyPaymentState; checked: boolean }> => {
      const { payonifyGateFor, applyPayonifyCharge } =
        await import("@/lib/payonify.process.server");
      const { chargeFacts, getCharge } = await import("@/lib/payonify.server");
      const gate = payonifyGateFor(process.env, context.userId);
      if (!gate.ok) return { state: "unknown", checked: false };

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0120 columns are not in the generated types yet
      const db = supabaseAdmin as any;
      const { data: p } = await db
        .from("payments")
        .select("id,user_id,status,provider,provider_reference")
        .eq("id", data.paymentId)
        .maybeSingle();
      if (!p || p.user_id !== context.userId || p.provider !== "payonify")
        return { state: "unknown", checked: false };
      if (p.status !== "initiated" || !p.provider_reference)
        return { state: stateOf(p.status), checked: false };

      try {
        const facts = chargeFacts(await getCharge(gate.cfg, p.provider_reference));
        const applied = await applyPayonifyCharge(db, p.id, "poll", null, facts);
        return {
          state: applied.ok ? stateOf(applied.status) : stateOf(p.status),
          checked: applied.ok,
        };
      } catch {
        return { state: stateOf(p.status), checked: false };
      }
    },
  );

// --- Admin visibility ------------------------------------------------------------------
// Read-only overview plus "Check with Payonify", which asks Payonify for the charge and
// applies its answer through the same guarded function. There is deliberately no
// "mark paid" action: an unpaid payment can only become paid from Payonify's own record.

async function requireAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0120 tables are not in the generated types yet
  const db = supabaseAdmin as any;
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId);
  const ok = (roles ?? []).some(
    (r: { role: string }) => r.role === "admin" || r.role === "super_admin",
  );
  if (!ok) throw new Error("Admins only");
  return db;
}

export type PayonifyAdminOverview = {
  installed: boolean;
  enabledHere: boolean;
  payments: Array<{
    id: string;
    job_id: string | null;
    amount: number;
    status: string;
    provider_reference: string | null;
    provider_livemode: boolean | null;
    created_at: string;
    last_checked_at: string | null;
    check_count: number;
  }>;
  events: Array<{
    event_id: string;
    event_type: string;
    object_id: string | null;
    outcome: string;
    received_at: string;
  }>;
  history: Array<{
    payment_id: string;
    source: string;
    reported_status: string | null;
    outcome: string;
    created_at: string;
  }>;
};

export const adminPayonifyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PayonifyAdminOverview> => {
    const db = await requireAdmin(context.userId);
    const { payonifyServerGate } = await import("@/lib/payonify.process.server");
    const enabledHere = payonifyServerGate(process.env).ok;
    const pays = await db
      .from("payments")
      .select(
        "id,job_id,amount,status,provider_reference,provider_livemode,created_at,last_checked_at,check_count",
      )
      .eq("provider", "payonify")
      .order("created_at", { ascending: false })
      .limit(30);
    if (pays.error) return { installed: false, enabledHere, payments: [], events: [], history: [] };
    const events = await db
      .from("payonify_webhook_events")
      .select("event_id,event_type,object_id,outcome,received_at")
      .order("received_at", { ascending: false })
      .limit(20);
    const history = await db
      .from("payment_events")
      .select("payment_id,source,reported_status,outcome,created_at")
      .eq("provider", "payonify")
      .order("created_at", { ascending: false })
      .limit(40);
    return {
      installed: true,
      enabledHere,
      payments: pays.data ?? [],
      events: events.data ?? [],
      history: history.data ?? [],
    };
  });

export const adminCheckPayonifyPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => {
    if (!data?.paymentId || typeof data.paymentId !== "string") throw new Error("Missing payment");
    return { paymentId: data.paymentId };
  })
  .handler(async ({ data, context }): Promise<{ ok: boolean; outcome: string }> => {
    const db = await requireAdmin(context.userId);
    const { payonifyServerGate, applyPayonifyCharge } =
      await import("@/lib/payonify.process.server");
    const { chargeFacts, getCharge } = await import("@/lib/payonify.server");
    const gate = payonifyServerGate(process.env);
    if (!gate.ok) return { ok: false, outcome: `payonify_${gate.reason}` };
    const { data: p } = await db
      .from("payments")
      .select("id,provider,provider_reference")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (!p || p.provider !== "payonify") return { ok: false, outcome: "not_a_payonify_payment" };
    if (!p.provider_reference) return { ok: false, outcome: "no_charge_id_check_dashboard" };
    try {
      const facts = chargeFacts(await getCharge(gate.cfg, p.provider_reference));
      const applied = await applyPayonifyCharge(db, p.id, "reconcile", null, facts);
      return applied.ok
        ? { ok: true, outcome: applied.outcome }
        : { ok: false, outcome: "db_error" };
    } catch {
      return { ok: false, outcome: "payonify_unreachable" };
    }
  });
