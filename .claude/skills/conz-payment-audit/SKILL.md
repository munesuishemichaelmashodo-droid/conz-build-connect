---
name: conz-payment-audit
description: Use to establish what ConZ's payment code actually does today — Paynow top-ups, IPN/poll handling, wallet credits, commission hold/settle/release, cancellations, manual top-ups, escrow/withdrawal switches, reconciliation — from source, live catalog reads and tests. Read-only. For changing anything, follow conz-safe-db-change; for adversarial money probes, conz-money-flow-audit.
---

# ConZ payment audit (read-only)

## When to use
- Before any payment design decision or provider change.
- After a payment-related merge or migration, to refresh `docs/payments/CURRENT-STATE-AUDIT.md`.
- When a top-up, commission or balance looks wrong.

## Map (start here, then confirm it still holds)
- App: `src/lib/paynow.server.ts` (hash, initiate, poll, `processPaynowIpn`), `src/lib/paynow.functions.ts`
  (`initiatePaynowTopup`, `initiateEscrowPayment`, `reconcilePendingPaynowPayments`),
  `src/lib/paynow.reconcile.server.ts`, routes `src/routes/api/public/paynow-ipn.ts`,
  `src/routes/api/internal/paynow-reconcile.ts`, wallet UI `src/routes/_authenticated/wallet.tsx`.
- Database (read live with `pg_get_functiondef`, never assume git = live): `apply_paynow_result`,
  `credit_wallet_from_payment`, `hold_job_commission`, `release_job_commission`, `settle_direct_pay_job`,
  `complete_job`, `driver_confirm_delivery_pin`, `cancel_job`, `request_topup`, `admin_approve_topup`,
  `request_paynow_reconcile`, `run_financial_reconciliation`, `post_ledger`, triggers on `payments` and `wallets`.
- Tables: `payments`, `payment_events`, `wallets` (balance, held, withdrawal_reserved), `wallet_transactions`,
  `platform_ledger`, `wallet_topup_requests`, `system_settings` (commission_rate, escrow_enabled,
  withdrawals_enabled, min_topup, max_wallet_balance).

## Workflow
1. Baseline: branch, HEAD, deployed commit (`origin/main`), `git status`.
2. Trace each path end to end: UI call → server function → RPC → rows written → ledger lines → notifications.
3. Read production definitions and aggregate counts only (no names, phones, emails, references). Compare
   function bodies with git by whitespace-free md5.
4. Run the fast checks: `npm run typecheck`, `npm test`, note which DB-backed tests are skipped in CI.
5. Classify every finding: **Source** (current code), **Live** (production read or endpoint probe),
   **Doc** (older report, unverified), **Unknown** (needs access). Never merge classes.
6. Update `docs/payments/CURRENT-STATE-AUDIT.md` in place.

## Never
Write to production, initiate a payment, print secrets or poll URLs, or call a mocked test a provider test.

## Output
Findings table: ID | severity | file/function | evidence class | evidence | impact | smallest fix | test.
