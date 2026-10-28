// Automatic driver payouts (0121): sends queued driver_payouts rows to the driver's EcoCash through
// Payonify Relay, and records what Payonify says. The database decides what is owed (rows are created
// when a Con Z Pay job is released); this module only moves queued rows forward.
//
// Rules:
//   * Every attempt for one payout reuses its idempotency key, so a retry after a timeout can't pay twice.
//   * The driver gets exactly their share (amount); ConZ's commission is not sent anywhere: it stays in the
//     Payonify balance. application_fee_amount is 0 until its exact effect is confirmed in sandbox.
//   * "Not enough settled funds" and set-up problems wait and retry; a refused recipient returns the money
//     to the driver's wallet; anything unclear stays 'sending' and is retried with the same key later.

import type { PayonifyConfig, PayonifyMode, Transfer, TransferFacts } from "@/lib/payonify.server";
import {
  createTransfer,
  getTransfer,
  PayonifyError,
  toMinorUnits,
  transferFacts,
} from "@/lib/payonify.server";
import type { RpcDb } from "@/lib/payonify.process.server";

export type PayoutRow = {
  id: string;
  driver_id: string;
  job_id: string;
  amount: number | string;
  currency: string;
  livemode: boolean;
  ecocash_number: string | null;
  status: string;
  idempotency_key: string;
  provider_reference: string | null;
  attempts: number;
};

export type PayoutDeps = {
  sendTransfer?: typeof createTransfer;
  fetchTransfer?: (cfg: PayonifyConfig, id: string) => Promise<Transfer>;
  /** Stop starting new sends after this many ms (serverless time limit). */
  deadlineMs?: number;
  now?: () => number;
};

export type PayoutSummary = {
  claimed: number;
  sent: number;
  succeeded: number;
  returned: number;
  waiting: number;
  unclear: number;
  lookedUp: number;
  errors: number;
};

// Errors that mean "try again later", nothing was sent.
const RETRY_LATER: Record<string, number> = {
  insufficient_funds: 60, // charge funds not settled yet (or balance too low)
  relay_not_enabled: 360, // project set-up; admins are told by the failure code on the row
  channel_partner_not_found: 360,
  b2c_not_allowed: 360,
  rate_limited: 5,
};
// Errors that mean the recipient can't be paid this way: money goes back to the wallet.
const RETURN_TO_WALLET = new Set([
  "invalid_destination",
  "recipient_not_found",
  "parameter_invalid",
]);

async function rpc(db: RpcDb, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

function asRows(data: unknown): PayoutRow[] {
  if (Array.isArray(data)) return data as PayoutRow[];
  return data ? [data as PayoutRow] : [];
}

const cents = (n: number | null) => (n == null ? null : n / 100);

async function applyTransferFacts(
  db: RpcDb,
  row: PayoutRow,
  facts: TransferFacts,
  summary: PayoutSummary,
): Promise<void> {
  if (facts.status === "succeeded") {
    await rpc(db, "payout_record_result", {
      _id: row.id,
      _outcome: "succeeded",
      _reference: facts.id,
      _net_amount: cents(facts.netMinor),
    });
    summary.succeeded++;
  } else if (facts.status === "failed") {
    await rpc(db, "payout_record_result", {
      _id: row.id,
      _outcome: "failed",
      _reference: facts.id,
      _failure_code: facts.failureCode ?? "transfer_failed",
      _failure_message: facts.failureMessage ?? "Payonify could not complete the transfer",
    });
    summary.returned++;
  } else {
    await rpc(db, "payout_record_sent", {
      _id: row.id,
      _reference: facts.id,
      _net_amount: cents(facts.netMinor),
    });
    summary.sent++;
  }
}

/** Sends one claimed payout. Never throws for Payonify errors; records the outcome instead. */
export async function sendPayout(
  db: RpcDb,
  cfg: PayonifyConfig,
  row: PayoutRow,
  summary: PayoutSummary,
  deps: PayoutDeps = {},
): Promise<void> {
  if (!row.ecocash_number) {
    // Should not happen (only numbered rows are queued); leave it for a human.
    summary.errors++;
    return;
  }
  if (row.livemode !== (cfg.mode === "live")) {
    summary.errors++;
    return;
  }
  let amountMinor: number;
  try {
    amountMinor = toMinorUnits(String(row.amount));
  } catch {
    summary.errors++;
    return;
  }
  let transfer: Transfer;
  try {
    transfer = await (deps.sendTransfer ?? createTransfer)(cfg, {
      amountMinor,
      commissionMinor: 0,
      currency: row.currency.toLowerCase() === "zwg" ? "zwg" : "usd",
      mobileNumber: row.ecocash_number,
      description: `Con Z driver payout ${row.id}`,
      idempotencyKey: row.idempotency_key,
    });
  } catch (err) {
    const code = err instanceof PayonifyError ? err.code : null;
    const status = err instanceof PayonifyError ? err.status : 0;
    if (code && code in RETRY_LATER) {
      await rpc(db, "payout_record_result", {
        _id: row.id,
        _outcome: "retry_later",
        _failure_code: code,
        _failure_message: err instanceof Error ? err.message.slice(0, 300) : null,
        _retry_minutes: RETRY_LATER[code],
      });
      summary.waiting++;
    } else if (code && RETURN_TO_WALLET.has(code) && status >= 400 && status < 500) {
      await rpc(db, "payout_record_result", {
        _id: row.id,
        _outcome: "failed",
        _failure_code: code,
        _failure_message: err instanceof Error ? err.message.slice(0, 300) : null,
      });
      summary.returned++;
    } else {
      // Timeout, 5xx, idempotency conflict or an unknown answer: the transfer may exist. The row stays
      // 'sending'; the next run retries with the same idempotency key, which can't create a second one.
      summary.unclear++;
    }
    return;
  }
  const facts = transferFacts(transfer);
  if (!facts.id || facts.livemode !== (cfg.mode === "live")) {
    summary.unclear++;
    return;
  }
  if (facts.amountMinor != null && facts.amountMinor !== amountMinor) {
    // Payonify reports a different amount: record the reference (so it's never re-sent) and let admins see it.
    await rpc(db, "payout_record_sent", { _id: row.id, _reference: facts.id, _net_amount: null });
    summary.errors++;
    return;
  }
  await applyTransferFacts(db, row, facts, summary);
}

/** Looks up a transfer Payonify accepted earlier and records its final state. */
export async function lookUpPayout(
  db: RpcDb,
  cfg: PayonifyConfig,
  row: PayoutRow,
  summary: PayoutSummary,
  deps: PayoutDeps = {},
): Promise<void> {
  if (!row.provider_reference) return;
  try {
    const t = await (deps.fetchTransfer ?? getTransfer)(cfg, row.provider_reference);
    const facts = transferFacts(t);
    if (facts.id !== row.provider_reference) {
      summary.errors++;
      return;
    }
    summary.lookedUp++;
    if (facts.status === "succeeded" || facts.status === "failed") {
      await applyTransferFacts(db, row, facts, summary);
    }
  } catch {
    summary.errors++;
  }
}

/** One run: send what is due, then look up sent transfers whose result hasn't arrived. */
export async function processPayouts(
  db: RpcDb,
  cfg: PayonifyConfig,
  mode: PayonifyMode,
  deps: PayoutDeps = {},
  limit = 10,
): Promise<PayoutSummary> {
  const summary: PayoutSummary = {
    claimed: 0,
    sent: 0,
    succeeded: 0,
    returned: 0,
    waiting: 0,
    unclear: 0,
    lookedUp: 0,
    errors: 0,
  };
  const now = deps.now ?? Date.now;
  const start = now();
  const livemode = mode === "live";
  const claimed = asRows(
    await rpc(db, "payout_claim_next", { _limit: limit, _livemode: livemode }),
  );
  summary.claimed = claimed.length;
  for (const row of claimed) {
    if (deps.deadlineMs && now() - start > deps.deadlineMs) break; // left 'sending'; next run resumes
    try {
      await sendPayout(db, cfg, row, summary, deps);
    } catch {
      summary.errors++;
    }
  }
  const due = asRows(await rpc(db, "payout_due_lookups", { _limit: limit, _livemode: livemode }));
  for (const row of due) {
    if (deps.deadlineMs && now() - start > deps.deadlineMs) break;
    await lookUpPayout(db, cfg, row, summary, deps);
  }
  return summary;
}

/** Webhook: transfer.succeeded / transfer.failed. Re-fetches the transfer; never trusts the body. */
export async function applyTransferEvent(
  db: RpcDb & {
    from: (t: "driver_payouts") => {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => { maybeSingle: () => PromiseLike<{ data: PayoutRow | null; error: unknown }> };
      };
    };
  },
  cfg: PayonifyConfig,
  transferId: string,
  deps: PayoutDeps = {},
): Promise<"applied" | "unknown_transfer" | "lookup_failed" | "pending"> {
  const { data: row } = await db
    .from("driver_payouts")
    .select("*")
    .eq("provider_reference", transferId)
    .maybeSingle();
  if (!row) return "unknown_transfer";
  const summary = {
    claimed: 0,
    sent: 0,
    succeeded: 0,
    returned: 0,
    waiting: 0,
    unclear: 0,
    lookedUp: 0,
    errors: 0,
  };
  await lookUpPayout(db, cfg, row, summary, deps);
  if (summary.errors) return "lookup_failed";
  return summary.succeeded || summary.returned ? "applied" : "pending";
}
