# ConZ wallet / ordering / payment completion — status 2026-10-12 (local, uncommitted)

## Implemented (migration 0095 + UI)
- **Withdrawal reservation**: `wallets.withdrawal_reserved`; a pending request reserves its amount; released on approve (debit takes over), reject, cancel. Available = balance − held − reserved (`wallet_available`, `driver_can_accept(_for)`, dashboard, admin debits).
- **Failed payout**: status `failed`; `admin_mark_withdrawal_failed` reverses the approval debit (linked wallet transaction, balancing ledger entry, audit, notification). Refused once a payout is recorded as sent. Idempotent.
- **`limited` flag**: intended logic = limited while balance < 0. Trigger `wallets_limited_follows_balance` now enforces it; credits no longer lift it unconditionally.
- **Top-up controls**: Paynow top-up attempts limited to 5/hour, 20/day per user; manual top-up requests need a reference (≥4 chars), unique per method (while pending/approved).
- **Reconciliation**: two new checks (reserved == pending requests; every failed payout reversed once).
- UI: wallet shows reserved funds in available; failed state; admin "Payout failed" button.

## Already in place (verified, not changed)
Admin adjustments: mandatory category + reason (≥5), daily caps, super_admin + aal2 for credits, second approval above threshold, reversal (never delete), audit, notification. Status jumps blocked by `jobs_guard_direct_write`. Flat 7% for all tiers (test 170). Paynow credit-once (apply_paynow_result, row lock, S1 concurrency).

## Decisions kept (owner policy)
- **First-job-free**: Terms s.6 and the job UI state the first completed job of a newly verified driver is commission-free. Both direct-pay and escrow paths apply it once (test 240). Remove it only if the owner decides to.
- Direct-pay `complete_job` is customer-confirmed (no driver PIN/photo); the customer is the authority and the driver is the only party charged. Escrow driver-side completion requires delivery photo + PIN.
- Admin credits cannot leave a wallet negative (`admin_apply_wallet_change`); an overdrawn wallet is cleared by Paynow top-up or earnings.

## Not done / needs owner or real devices
Forgotten-PIN recovery design; MFA policy conflict (hosted requires aal2 for super_admin money actions vs owner's no-MFA decision) — unchanged; notification push delivery on real devices; 0077–0095 not applied to production.


---
# Owner decisions implemented (migration 0096) — supersedes the two stale lines above

(Stale above: "`complete_job` is customer-confirmed (no driver PIN/photo)" and "MFA policy conflict ... unchanged". Both are replaced by this section.)

## What changed
**Migration `20261012100000_0096_delivery_proof_both_modes.sql`** (local only; NOT applied to hosted; apply after 0077–0095 and only after the app that sends the PIN is deployed):
- Delivery proof is now identical for direct-pay and escrow. Every accepted job gets a PIN row (`job_delivery_pins`), expiring after 7 days, burnt on completion (`consumed_at`), rotatable by the customer (`regenerate_delivery_pin`).
- `delivery_proof_check` (shared): needs a `job_evidence` row of kind `delivery`, same job, uploaded by the job's driver, whose path equals `jobs.delivery_photo_url`; then the PIN (wrong / expired / consumed / locked → refused; attempts counted and committed; 5 failures = 15 min lock, 10+ = 24 h, shared by both endpoints).
- `complete_job(job, pin)` (customer only; other users refused) and `driver_confirm_delivery_pin` (assigned driver only) both call it, then `release_escrow_and_complete` (escrow) or the new `settle_direct_pay_job` (direct-pay: wallet commission debit). Repeats on a completed job are no-ops (`already: true`): no second commission, ledger row or notification.
- First-job-free race closed: both settlement functions lock the driver profile row (`FOR UPDATE`) before deciding "first job".
- Auto-release at 72 h and dispute resolution still call the escrow release directly (not PIN-gated by design: the customer is absent / an admin decides).
- `require_aal2()` now also checks freshness of the second factor (JWT `amr`, default 15 min, setting `system_settings.admin_stepup`).
- New trigger `trg_withdrawal_payout_stepup`: approving a withdrawal, recording it sent, or marking it failed needs a fresh second factor for EVERY admin role (previously only super admins). Reject/cancel stay MFA-free. **This is a policy tightening — owner to confirm; revert = drop the trigger.**

## Commission
Unchanged: first completed job of a newly verified driver is commission-free; later jobs flat 7% for Bronze/Silver/Gold/Platinum (`commission_amount`). Retries cannot double-deduct (status/idempotency guards + profile lock).

## Admin: ordinary vs sensitive
- Login and ordinary admin work (viewing queues, rejecting requests, reports): no MFA enrolment required.
- Sensitive money actions need aal2 + a second factor verified in the last 15 min, enforced in the database: wallet credits (super admin only), credit requests, top-up approvals, withdrawal approve / mark-sent / mark-failed, credits over the second-approval threshold also need a second super admin. The admin screens show the database's message with a "Verify" button.
- Compatibility choice: a token with aal2 but no `amr` claim is accepted (no timing information) rather than locking admins out.

## Tests
- `250_delivery_proof_both_modes.test.sql` (54) and `260_admin_stepup.test.sql` (34); helpers `tests.deliver`, `tests.complete`, `login_as_mfa_aged`, `login_as_mfa_no_amr`; existing tests updated to supply evidence + PIN and fresh MFA (guards not weakened).
- `tests/unit/mfa.test.ts` (UI step-up messaging).
- `scripts/db-concurrency-check.sh` now has true parallel-session scenarios S7 (10 simultaneous customer confirmations of one direct-pay job → 1 settlement, 9 already-complete, 28.00 commission once) and S8 (two simultaneous first-eligible jobs → exactly one commission-free, one charged 7%); S2/S3/S6 now log in with a fresh second factor. Result on the stand-in Postgres: S1–S8 all PASS. Not yet run against the real Docker database.

## Verification status (see final report for the commands and results)
- Real Docker/Supabase suite: NOT yet run on 0096 (last real pass 24 files / 654 tests was before 0096). Run: `node scripts/db-test.mjs stop`, `start`, `test`.
- Stand-in Postgres 16 (not Supabase, pgTAP emulated): 26 files / 742 assertions pass. Stand-in only.
- Not verified: browser/device behaviour of the new PIN screens, Paynow, push delivery.
- Known gaps: forgotten-PIN recovery (customer can issue a new code while the job is open); push trigger URL is hard-coded to production.
