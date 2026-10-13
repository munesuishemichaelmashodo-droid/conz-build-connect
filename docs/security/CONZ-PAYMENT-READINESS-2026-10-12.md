# ConZ payment verification and Paynow readiness (12/10/2026)

Environment: local stand-in Postgres 16; Paynow provider MOCKED. No live or sandbox Paynow call, no real money.

## Verified
- Callback (IPN) idempotency, `tests/unit/paynow-ipn-db.test.ts` (9 tests, real `processPaynowIpn` → real `apply_paynow_result`,
  DB-backed, runs only with `CONZ_TEST_PG_HOST`/`CONZ_TEST_PG_DB`): tampered hash 401; amount mismatch not credited; bad reference 400;
  unknown payment 404; credit exactly once under duplicate and out-of-order messages; no regression after Paid; Paid-after-Cancelled
  → `late_success_flagged` (never auto-credited, admins notified); 10 parallel deliveries credit once; unconfigured → 503.
- Concurrency S1 (10 parallel IPNs credit once), S2-S6 (withdrawal approve/mark-paid/failed), S7 (10 parallel confirmations settle once),
  S8 (first-job-free exactly once), S9-S11 (assignment races).
- Ledger reconciliation: test 110 and `run_financial_reconciliation`. Refunds: tests 030/190 (sequential; second refund refused).
  Withdrawals/settlement: 200, 210, 230, 270.
- Parallel duplicate refund, now TESTED (stand-in Postgres, 3 consecutive runs): S12 = 8 parallel `admin_mark_escrow_refunded`
  by a super admin with MFA → all return refunded, exactly 2 ledger lines, 1 audit row, 1 customer notice, driver wallet untouched.
  S13 = release vs `escrow_mark_refund_due` race on one paid escrow payment, 5 rounds per run → never both outcomes; both orders
  occurred across runs (released 2-3 rounds, refund_due 2-3 rounds); money consistent every round (driver +$279 only if released).

## Sandbox readiness checklist (owner/hosting actions, none performed)
- Vercel env: `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY`, `PAYNOW_RECONCILE_SECRET` (values never in git/chat).
- Paynow result/IPN URL points at the deployed route; test mode/integration enabled in the Paynow dashboard.
- Run the $1 runbook (`CONZ-PAYNOW-1USD-TEST-RUNBOOK.md`) only with your explicit approval.
- Operations: a `late_success_flagged` payment means money arrived after cancellation: refund the payer manually, never credit.
- Duplicate payment for an already-paid job notifies admins: refund the duplicate.
- After go-live of Stage B: run `run_financial_reconciliation` and review mismatches daily.
