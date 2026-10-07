// Server-only: poll Paynow for payments still awaiting a result and apply
// each verified answer through apply_paynow_result() (audit F3 / F9).
//
// Used by the scheduled reconcile endpoint (/api/internal/paynow-reconcile,
// driven by pg_cron) and by the user-triggered reconcile on the wallet / job
// pages, so confirmation no longer depends on the customer reopening a page.

import { applyPaynowResult, pollPaynowStatus, type PaynowResultDb } from "@/lib/paynow.server";

export type PendingPayment = { id: string; paynow_poll_url: string | null; created_at?: string };

export type ReconcileSummary = {
  checked: number;
  applied: Record<string, number>;
  errors: number;
  expired: number;
};

type ReconcileDb = PaynowResultDb & {
  rpc: PaynowResultDb["rpc"] &
    ((fn: "expire_stale_paynow_payment", args: { _payment_id: string }) => PromiseLike<{ data: unknown; error: unknown }>);
};

const ABANDONED_AFTER_MS = 72 * 60 * 60 * 1000;

export async function reconcilePayments(
  db: ReconcileDb,
  pending: PendingPayment[],
  source: "poll" | "reconcile",
  opts: { deadlineMs?: number } = {},
): Promise<ReconcileSummary> {
  const started = Date.now();
  const summary: ReconcileSummary = { checked: 0, applied: {}, errors: 0, expired: 0 };

  for (const p of pending) {
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) break;
    if (!p.paynow_poll_url) continue;
    summary.checked += 1;

    const polled = await pollPaynowStatus(p.paynow_poll_url);
    if (!polled.ok) {
      summary.errors += 1;
      console.warn(`[paynow-reconcile] poll failed for ${p.id}: ${polled.error}`);
      continue;
    }

    const applied = await applyPaynowResult(db, p.id, source, polled);
    if (!applied.ok) {
      summary.errors += 1;
      console.error(`[paynow-reconcile] apply failed for ${p.id}: ${applied.error}`);
      continue;
    }
    summary.applied[applied.outcome] = (summary.applied[applied.outcome] ?? 0) + 1;

    // Still unpaid at Paynow long after initiation: close it so a later
    // success is flagged for review instead of silently credited.
    const ageMs = p.created_at ? Date.now() - new Date(p.created_at).getTime() : 0;
    if (applied.outcome === "pending_no_change" && ageMs > ABANDONED_AFTER_MS) {
      const { data } = await db.rpc("expire_stale_paynow_payment", { _payment_id: p.id });
      if (data === "expired") summary.expired += 1;
    }
  }
  return summary;
}
