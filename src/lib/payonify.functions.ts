import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { topupAmountError } from "@/lib/paymentErrors";

// Payments through Payonify (EcoCash): Con Z Pay (escrow) and driver wallet top-ups.
// Off unless the server has PAYONIFY_MODE (test|live) with matching keys; test mode never runs
// against the production database. Listed testers see it first; everyone sees it only once a
// super admin sets the payment switch to Payonify. Until then Paynow is the option for everyone.
//
// The browser never decides a payment is paid: these functions only start a charge or ask
// Payonify for its status; the state change happens in apply_payonify_charge (migration 0120).

export type PayonifyPaymentState = "pending" | "paid" | "failed" | "cancelled" | "unknown";

export type PayonifyStartResult =
  | { ok: true; paymentId: string; state: PayonifyPaymentState; resumed?: boolean }
  | { ok: false; error: PayonifyStartError; paymentId?: string; message?: string };

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
  | "invalid_amount"
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

async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role RPCs/columns added by 0073+/0120 are not in the generated types yet
  return supabaseAdmin as any;
}

export type PaymentOptions = {
  /** Paynow may start new payments. */
  paynow: boolean;
  /**
   * After the switch to Payonify, Paynow is off unless PAYNOW_CARDS_AFTER_SWITCH=on; then it is
   * shown as "Card (Visa / Mastercard)" and EcoCash goes first.
   */
  paynowAsCard: boolean;
  /** Payonify may start new payments for this user. */
  payonify: boolean;
  /** "test" shows the test label; null when Payonify is not offered. */
  payonifyMode: "test" | "live" | null;
};

/** Which ways to pay this user is offered. Reveals nothing else. */
export const paymentOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentOptions> => {
    const { payonifyGateFor, readPaymentSwitch, paynowAllowed } =
      await import("@/lib/payonify.process.server");
    const db = await adminDb();
    const provider = await readPaymentSwitch(db);
    const gate = payonifyGateFor(process.env, context.userId, provider);
    const { getPaynowCredentials } = await import("@/lib/paynow.server");
    const paynowConfigured = !!getPaynowCredentials() && paynowAllowed(process.env, provider);
    return {
      paynow: paynowConfigured,
      paynowAsCard: paynowConfigured && provider === "payonify",
      payonify: gate.ok,
      payonifyMode: gate.ok ? gate.mode : null,
    };
  });

type PrevRow = {
  id: string;
  status: string;
  method: string | null;
  provider: string | null;
  provider_reference: string | null;
  created_at: string;
};

/** Ask Payonify about open attempts first, so a customer who already paid isn't charged twice. */
async function settleOpenAttempts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role client
  db: any,
  cfg: import("@/lib/payonify.server").PayonifyConfig,
  rows: PrevRow[],
) {
  const { applyPayonifyCharge } = await import("@/lib/payonify.process.server");
  const { chargeFacts, getCharge } = await import("@/lib/payonify.server");
  for (const p of rows) {
    if (p.status !== "initiated" || p.provider !== "payonify" || !p.provider_reference) continue;
    try {
      const facts = chargeFacts(await getCharge(cfg, p.provider_reference));
      await applyPayonifyCharge(db, p.id, "poll", null, facts);
    } catch {
      /* Payonify unreachable: the attempt stays open and blocks a new one. */
    }
  }
}

export const initiatePayonifyEscrowPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId: string; mobileNumber: string }) => {
    if (!data?.jobId || typeof data.jobId !== "string") throw new Error("Missing job");
    if (typeof data.mobileNumber !== "string" || data.mobileNumber.length > 20)
      throw new Error("Enter a valid EcoCash number");
    return { jobId: data.jobId, mobileNumber: data.mobileNumber };
  })
  .handler(async ({ data, context }): Promise<PayonifyStartResult> => {
    const { payonifyGateFor, readPaymentSwitch, startPayonifyCharge } =
      await import("@/lib/payonify.process.server");
    const { toEcocashNumber, toMinorUnits } = await import("@/lib/payonify.server");
    const db = await adminDb();

    const gate = payonifyGateFor(process.env, context.userId, await readPaymentSwitch(db));
    if (!gate.ok) return { ok: false, error: "payonify_unavailable" };

    let mobileNumber: string;
    try {
      mobileNumber = toEcocashNumber(data.mobileNumber);
    } catch {
      return { ok: false, error: "invalid_number" };
    }

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

    await settleOpenAttempts(db, gate.cfg, previous);
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

    const r = await startPayonifyCharge(
      db,
      gate,
      { userId: context.userId, jobId: data.jobId, type: "escrow", amount },
      {
        amountMinor,
        mobileNumber,
        description: `Con Z Pay - ${String(job.material ?? "material").slice(0, 40)} delivery`,
      },
    );
    return r.ok
      ? { ok: true, paymentId: r.paymentId, state: stateOf(r.status) }
      : { ok: false, error: r.error, paymentId: r.paymentId, message: r.message };
  });

/** Driver wallet top-up through EcoCash. Same limits as Paynow top-ups (enforced in the DB). */
export const initiatePayonifyTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { amount: number; mobileNumber: string }) => {
    const amount = Number(data?.amount);
    if (topupAmountError(amount)) throw new Error("Enter a valid amount between $1 and $100,000");
    if (typeof data.mobileNumber !== "string" || data.mobileNumber.length > 20)
      throw new Error("Enter a valid EcoCash number");
    return { amount: Math.round(amount * 100) / 100, mobileNumber: data.mobileNumber };
  })
  .handler(async ({ data, context }): Promise<PayonifyStartResult> => {
    const { payonifyGateFor, readPaymentSwitch, startPayonifyCharge } =
      await import("@/lib/payonify.process.server");
    const { toEcocashNumber, toMinorUnits } = await import("@/lib/payonify.server");
    const db = await adminDb();

    const gate = payonifyGateFor(process.env, context.userId, await readPaymentSwitch(db));
    if (!gate.ok) return { ok: false, error: "payonify_unavailable" };

    let mobileNumber: string;
    try {
      mobileNumber = toEcocashNumber(data.mobileNumber);
    } catch {
      return { ok: false, error: "invalid_number" };
    }
    let amountMinor: number;
    try {
      amountMinor = toMinorUnits(data.amount);
    } catch {
      return { ok: false, error: "invalid_amount" };
    }
    if (amountMinor < 100) return { ok: false, error: "invalid_amount" };

    // One open EcoCash top-up at a time: check it with Payonify first, then resume or refuse.
    const loadOpen = async (): Promise<PrevRow[]> => {
      const { data: rows } = await db
        .from("payments")
        .select("id,status,method,provider,provider_reference,created_at")
        .eq("user_id", context.userId)
        .eq("type", "topup")
        .eq("provider", "payonify")
        .eq("status", "initiated");
      return (rows ?? []) as PrevRow[];
    };
    await settleOpenAttempts(db, gate.cfg, await loadOpen());
    const open = (await loadOpen())[0];
    if (open) {
      return open.provider_reference
        ? { ok: true, paymentId: open.id, state: "pending", resumed: true }
        : { ok: false, error: "previous_attempt_unclear", paymentId: open.id };
    }

    const r = await startPayonifyCharge(
      db,
      gate,
      { userId: context.userId, jobId: null, type: "topup", amount: data.amount },
      { amountMinor, mobileNumber, description: "ConZ wallet top-up" },
    );
    // The database's top-up limits (minimum, wallet cap) refuse the insert: say so plainly.
    return r.ok
      ? { ok: true, paymentId: r.paymentId, state: stateOf(r.status) }
      : { ok: false, error: r.error, paymentId: r.paymentId, message: r.message };
  });

/** "Check status": asks Payonify about this user's own payment and applies the answer. */
export const refreshPayonifyPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { paymentId: string }) => {
    if (!data?.paymentId || typeof data.paymentId !== "string") throw new Error("Missing payment");
    return { paymentId: data.paymentId };
  })
  .handler(
    async ({ data, context }): Promise<{ state: PayonifyPaymentState; checked: boolean }> => {
      const { payonifyServerGate, applyPayonifyCharge } =
        await import("@/lib/payonify.process.server");
      const { chargeFacts, getCharge } = await import("@/lib/payonify.server");
      // Checking an existing payment needs only a configured server, not the tester list or
      // the switch: a payment started before a switch-back must still be able to finish.
      const gate = payonifyServerGate(process.env);
      if (!gate.ok) return { state: "unknown", checked: false };

      const db = await adminDb();
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
  /** Mode this deployment is configured for, or why Payonify is off here. */
  serverMode: "test" | "live" | null;
  serverReason: string | null;
  /** Names of Payonify settings that are empty here (no values). */
  serverMissing: string[];
  /** The payment switch: which provider takes new payments. */
  switchProvider: "paynow" | "payonify";
  /** After the switch, Paynow still takes cards (PAYNOW_CARDS_AFTER_SWITCH=on). Off by default. */
  cardsAfterSwitch: boolean;
  /** Relay balance for this deployment's mode (dollars), or null when unavailable. */
  relayBalance: Array<{
    provider: string;
    currency: string;
    available: number;
    pending: number;
  }> | null;
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
    const {
      payonifyMissingSettings,
      payonifyServerGate,
      readPaymentSwitch,
      paynowCardsAfterSwitch,
    } = await import("@/lib/payonify.process.server");
    const gate = payonifyServerGate(process.env);
    const enabledHere = gate.ok;
    const serverMode = gate.ok ? gate.mode : null;
    const serverReason = gate.ok ? null : gate.reason;
    const serverMissing = payonifyMissingSettings(process.env);
    const switchProvider = await readPaymentSwitch(db);
    let relayBalance: PayonifyAdminOverview["relayBalance"] = null;
    if (gate.ok) {
      try {
        const { getRelayBalance } = await import("@/lib/payonify.server");
        relayBalance = ((await getRelayBalance(gate.cfg)).balances ?? []).map((b) => ({
          provider: b.provider,
          currency: b.currency,
          available: Number(b.available) / 100,
          pending: Number(b.pending) / 100,
        }));
      } catch {
        relayBalance = null; // Relay not enabled or Payonify unreachable
      }
    }
    const pays = await db
      .from("payments")
      .select(
        "id,job_id,amount,status,provider_reference,provider_livemode,created_at,last_checked_at,check_count",
      )
      .eq("provider", "payonify")
      .order("created_at", { ascending: false })
      .limit(30);
    if (pays.error)
      return {
        installed: false,
        enabledHere,
        serverMode,
        serverReason,
        serverMissing,
        switchProvider,
        cardsAfterSwitch: paynowCardsAfterSwitch(process.env),
        relayBalance,
        payments: [],
        events: [],
        history: [],
      };
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
      serverMode,
      serverReason,
      serverMissing,
      switchProvider,
      cardsAfterSwitch: paynowCardsAfterSwitch(process.env),
      relayBalance,
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

/**
 * Sends the driver payout for a job that has just been completed, instead of waiting for the next
 * scheduled run (0121). Only a party to the job can ask, and only payouts the database already queued
 * are sent; asking twice is harmless.
 */
export const kickJobPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId: string }) => {
    if (!data?.jobId || typeof data.jobId !== "string") throw new Error("Missing job");
    return { jobId: data.jobId };
  })
  .handler(async ({ data, context }): Promise<{ status: string | null }> => {
    const { payonifyServerGate } = await import("@/lib/payonify.process.server");
    const gate = payonifyServerGate(process.env);
    if (!gate.ok) return { status: null };
    const db = await adminDb();
    const { data: job } = await db
      .from("jobs")
      .select("id,customer_id,driver_id,status")
      .eq("id", data.jobId)
      .maybeSingle();
    if (!job || (job.customer_id !== context.userId && job.driver_id !== context.userId))
      return { status: null };
    const payouts = db as unknown as {
      from: (t: "driver_payouts") => {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => { maybeSingle: () => PromiseLike<{ data: { status: string } | null }> };
        };
      };
    };
    const read = async () =>
      (await payouts.from("driver_payouts").select("status").eq("job_id", data.jobId).maybeSingle())
        .data?.status ?? null;
    const before = await read();
    if (before !== "queued") return { status: before };
    const { processPayouts } = await import("@/lib/payonify.payouts.server");
    await processPayouts(db as never, gate.cfg, gate.mode, { deadlineMs: 15_000 }, 5);
    return { status: await read() };
  });
