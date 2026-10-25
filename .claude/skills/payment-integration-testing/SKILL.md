---
name: payment-integration-testing
description: Use to prove a ConZ payment flow works — unit, database (pgTAP), DB-backed IPN tests, provider test mode, and the owner-run $1 live test — and to report which level of proof was reached. Never moves real money without the owner's written approval.
---

# Payment integration testing

## Levels of proof (report the highest reached, never merge them)
1. **Unit** — `npm test` (`tests/unit/paynow.server.test.ts`, `payment-errors.test.ts`): hash, parsing, poll-URL rules.
2. **Database** — `node scripts/db-test.mjs start && npm run test:db`: state machine (020), escrow (030),
   admin money (050), ledger (110), commission (170, 240), audit fixes (190), withdrawals (200–270).
3. **DB-backed IPN** — `tests/unit/paynow-ipn-db.test.ts` with `CONZ_TEST_PG_HOST`/`CONZ_TEST_PG_DB` set
   (skipped in CI otherwise — say so). Concurrency: `scripts/db-concurrency-check.sh`.
4. **Provider test mode** — Paynow integration in test mode, its documented test numbers, a staging or preview
   deployment whose result URL is reachable. Proves hash format and callback delivery.
5. **Live $1** — owner-approved, `docs/security/CONZ-PAYNOW-1USD-TEST-RUNBOOK.md`. Proves the real account,
   settlement and IPN delivery to production.

## Workflow
1. State the flow and the level you need.
2. Run lower levels first; a failure there stops the run.
3. For levels 4–5 write the expected rows before starting: `payments` status, one `payment_events` row per
   message, one `wallet_transactions` row, one `platform_ledger` entry, wallet delta, notification.
4. After the run, check those rows with read-only, aggregate queries; record pass/fail per row.
5. Required negative cases: forged hash, wrong amount, wrong reference, duplicate IPN, late success after
   cancel, poll and IPN racing, cancelled payment, top-up over the wallet cap, rate-limit hit.

## Output
Table: flow | level | command or step | expected | observed | pass/fail | environment | date.
