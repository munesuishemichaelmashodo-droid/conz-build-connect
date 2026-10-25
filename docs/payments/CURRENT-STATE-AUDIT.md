# ConZ payments — current-state audit

As of 25/10/2026. Deployed app: `main` @ `35cdf55`. Production: Supabase `ovwrsocjmkpiygipmrdk`.
Read-only: no code, data or settings were changed; no payment was made.

Evidence classes: **Source** = current code in git · **Live** = read-only production query or endpoint
probe on 24–25/10 · **Doc** = earlier report in `docs/security/`, not re-run · **Unknown** = needs access.

## 1. What money moves today

| Flow | Who pays whom | Through | Status |
| --- | --- | --- | --- |
| Job price | Customer → driver | Cash / mobile money, outside ConZ | Live (escrow off) |
| Commission credit | Driver → ConZ | Paynow web checkout (USD) | Built; last success 13/08/2026 (Live) |
| Commission credit (manual) | Driver → ConZ account, then admin approves | EcoCash / OneMoney / ZIPIT / bank reference | Database only; no driver form in the app (Source) |
| Commission charge | Driver wallet → ConZ revenue | Ledger entry at completion | Live |
| Escrow (Con Z Pay) | Customer → ConZ → driver | Paynow | Built, switched off (Live) |
| Withdrawals | ConZ → driver | Manual payout | Built, switched off (Live) |

## 2. Path traces

### Paynow top-up (Source + Live)
1. `wallet.tsx` → `initiatePaynowTopup` (`src/lib/paynow.functions.ts`): signed-in user, amount $1–$100,000
   checked on the server; inserts `payments` (type `topup`, USD, `initiated`). Triggers enforce
   `min_topup` = $1, `max_wallet_balance` = $150, 5 attempts per hour and 20 per day.
2. `initiatePaynowTransaction` (`src/lib/paynow.server.ts`): SHA-512 hash of fields + integration key;
   Paynow's response hash verified; poll URL accepted only on paynow.co.zw; reference = our payment id;
   result URL = `https://www.conz.co.zw/api/public/paynow-ipn`.
3. Callback `POST /api/public/paynow-ipn` → `processPaynowIpn`: duplicate field names rejected, hash checked in
   constant time, reference must be a UUID, then `apply_paynow_result`.
4. `apply_paynow_result` (Live body): locks the payment; reference must equal the payment id; for
   paid / awaiting delivery / delivered the amount must equal the stored amount; first success credits via
   `credit_wallet_from_payment`; repeats ignored; success after cancel/fail flagged to admins, never credited;
   refunded/disputed after credit flagged for a human; every message logged in `payment_events`.
5. `credit_wallet_from_payment` (Live body): USD only; adds to `wallets.balance`; writes `wallet_transactions`,
   a `platform_ledger` entry (`paynow_clearing` / `user_wallets`), `wallet_audit_log`, a notification; sets
   `payments.status = 'paid'`.
6. Backstops: the wallet screen polls the user's own pending top-ups (`reconcilePendingPaynowPayments`);
   cron `paynow-reconcile` every 10 min calls `request_paynow_reconcile`.

### Commission (Source + Live)
- Acceptance: `accept_bid` / `accept_counter` / `accept_dispatch_offer` → `driver_can_accept_for` (available =
  balance − held − withdrawal_reserved must cover 7% unless the first job is unused) → `hold_job_commission`
  (adds 7% to `wallets.held`, sets `jobs.held_commission`; 0 for a free first job).
- Completion: `complete_job` (customer) or `driver_confirm_delivery_pin` (driver) → `delivery_proof_check`
  (driver's delivery photo + customer code, lock after 5 wrong codes) → `settle_direct_pay_job`: releases the
  hold, then either marks the free first job used (commission 0) or charges 7% of `final_price` (or `budget`)
  from `balance`, writes `wallet_transactions` and ledger (`user_wallets` / `platform_revenue`).
- Cancellation: `cancel_job` releases the hold for open/accepted jobs; customers and drivers cannot cancel
  in-progress jobs (dispute instead); admins can; customer strikes and driver cancellation events recorded.
- Rate: `commission_rate` = 7 (Live); `driver_level_commission_multiplier` returns 1 for all levels.

### Manual top-up (Source + Live)
`request_topup` (method ecocash/onemoney/zipit/bank, reference ≥ 4 chars, reference unique, ≤ 5 pending) →
`admin_approve_topup` (super admin + `require_aal2`, not on own account, ledger `manual_topups_clearing`,
audit + admin log). The driver wallet screen lists and cancels requests but has **no form to create one**.

## 3. Live facts (aggregate, 24–25/10)

| Fact | Value |
| --- | --- |
| Settings | commission 7%, escrow off, withdrawals off, min top-up $1, wallet cap $150 |
| Paynow top-ups | 12 paid ($88, 09–13/08), 20 failed, 1 cancelled, 2 initiated (38 h and 46 h old, Paynow says pending) |
| Failed without a poll URL (Paynow rejected the start), top-up and escrow together | 8 of 23 failed — the reason is only in server logs, not stored |
| Callbacks recorded since `payment_events` began (09/10) | 0 callbacks, 6 polls |
| Manual top-up requests | 1 approved, 2 cancelled, 3 pending |
| Callback endpoint | configured (blank POST → 400) |
| Reconcile endpoint | not configured (blank POST → 503); `app_secrets` has no reconcile URL/secret |
| Nightly financial reconciliation | ran 24/10 00:00, ok |

## 4. Findings

| ID | Severity | Where | Class | Finding | Smallest fix |
| --- | --- | --- | --- | --- | --- |
| P-1 | P1 | `request_paynow_reconcile`, Vercel env, `app_secrets` | Live | Server-side re-check of stuck Paynow payments never runs; only the driver opening the wallet triggers a poll | Set `PAYNOW_RECONCILE_SECRET` in Vercel and the matching `app_secrets` rows (owner) |
| P-2 | P1 | Production Paynow account | Live | No successful Paynow top-up since 13/08; no callback ever recorded since 09/10 | Paynow test-mode run, then owner $1 live test |
| P-11 | P1 | `apply_paynow_result` + Paynow BuySafe | Source + provider docs | Wallets are credited on "Awaiting Delivery" / "Delivered". Paynow's own docs: BuySafe escrow is on by default and only Verified merchants may disable it; held funds settle only after delivery is confirmed and the buyer can dispute. A driver could spend credit, then dispute the top-up | Get Verified and ask Paynow to disable BuySafe; until confirmed, credit only on "Paid" (founder decision) |
| P-3 | P1 | `wallet.tsx` | Source | Drivers cannot submit a manual top-up although the database and admin approval exist | Re-add a small form calling `request_topup` (fallback channel) |
| P-4 | P2 | `credit_wallet_from_payment` | Live | `payments.paid_at` never set (all 12 paid rows empty) | Set `paid_at = now()` with the status change; backfill from `wallet_transactions` |
| P-5 | P2 | `initiatePaynowTopup` | Source | Paynow's rejection reason is logged, not stored, so 8 failed starts cannot be diagnosed | Store the error text (no secrets) on the payment row |
| P-6 | P2 | `settle_direct_pay_job` | Source | Commission is recomputed at completion from the current rate, not the held amount; a rate change between acceptance and completion can push a balance below zero | Charge `held_commission` when present; test it |
| P-7 | P2 | jobs in progress | Live | In-progress jobs never expire; 8 stale test trips (4–74 days) still hold $62.58 of one driver's credit | Admin cancels test trips; decide an in-progress timeout rule |
| P-8 | Decision | `commission_amount` callers | Source | Commission base is the whole job price, including material cost the driver pays the supplier | Founders choose the base |
| P-9 | Decision | `wallet.tsx` text | Source | "Contact support to get unused credit back" promises a manual payout while withdrawals are off | Founders decide the refund rule for unused credit |
| P-10 | P3 | `tests/unit/paynow-ipn-db.test.ts` | Source | 9 DB-backed callback tests are skipped in CI (need a test database) | Run them in the CI pgTAP job |

No confirmed P0. Escrow and withdrawals are blocked in the database (`launch_switches`, triggers) as well as hidden in the app (Live + Source).

## 5. Tests that exist

Unit: `paynow.server.test.ts`, `payment-errors.test.ts`, `paynow-ipn-db.test.ts` (skipped in CI).
pgTAP: 020 state machine, 030 escrow, 050 admin money, 110 ledger, 170 flat commission, 190 audit fixes,
200/210/230/270 withdrawals, 240 first job. Concurrency: `scripts/db-concurrency-check.sh` (Doc: S1–S13 passed 12/10).
None of these talk to Paynow: provider behaviour is unverified until the test-mode and $1 runs.

## 6. Unknowns
- Whether Paynow callbacks reach production today (P-2).
- Why the 20 Paynow attempts failed (cancelled by users, wrong numbers, or account issues).
- Whose name and tax number the Paynow merchant account uses.
- Paynow fees, settlement account and timing for ConZ's account.
