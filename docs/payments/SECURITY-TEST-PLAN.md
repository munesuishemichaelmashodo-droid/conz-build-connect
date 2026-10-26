# ConZ payments — security and failure test plan

Levels: **U** unit (`npm test`) · **D** database pgTAP (`npm run test:db`) · **I** DB-backed callback test
(`tests/unit/paynow-ipn-db.test.ts` with a test database) · **P** Paynow test mode on a preview deployment ·
**L** owner-approved $1 live test. "Exists" names the current test; "New" is to be written.

| # | Case | Expected | Level | Status |
| --- | --- | --- | --- | --- |
| 1 | Callback with a wrong hash | 401, no row change | U, I | Exists (`paynow.server.test.ts`, `paynow-ipn-db`) |
| 2 | Callback with a duplicated field name | 400 | U | Exists |
| 3 | Valid hash, reference not a UUID or unknown | 400 / 404, nothing credited | U, I | Exists |
| 4 | Valid hash, amount differs from the payment | No credit, `rejected_amount_mismatch`, admins alerted | D (020/190), I | Exists |
| 5 | Valid hash, reference of another payment | No credit, `rejected_reference_mismatch` | D, I | Exists |
| 6 | Same Paid callback twice, or 10 in parallel | One credit, one ledger entry | I, concurrency S1 | Exists (CI skips I) |
| 7 | Poll and callback race | One credit | I | Exists |
| 8 | Paid after the payment was cancelled | No credit, `late_success_flagged` | D, I | Exists |
| 9 | Failed after Paid | Status stays paid, admins alerted | D | Exists |
| 10 | Refunded / Disputed after credit | No automatic change, admins alerted | D | Exists |
| 11 | Replay of an old valid callback | `duplicate_ignored` | I | Exists |
| 12 | Browser return URL without a callback | No credit until a poll confirms | P | New (manual check) |
| 13 | Poll URL pointing outside paynow.co.zw | Refused | U | Exists |
| 14 | Top-up below $1, over the $150 cap, 6th attempt in an hour | Refused in the database | D | New |
| 15 | User updates own `wallets` / `wallet_transactions` / `payments` row | Refused (RLS, triggers) | D (050/120/260) | Exists |
| 16 | Client calls `credit_wallet_from_payment`, `apply_paynow_result`, `settle_direct_pay_job` | Permission denied | D | Exists |
| 17 | Accept a job with available credit below 7% | Refused with shortfall | D (240) | Exists |
| 18 | Two drivers accept the same job | One wins, one hold | concurrency S9 | Exists |
| 19 | Complete the same job twice / in parallel | One settlement | concurrency S7 | Exists |
| 20 | First free job used twice in parallel | Exactly one free | concurrency S8 | Exists |
| 21 | Cancel an accepted job | Hold released once; `held` never below 0 | D | Exists (partly) — New: assert wallet `held` |
| 22 | Commission rate changed between acceptance and completion | Charge equals the held amount, balance never below 0 | D | New (after decision P-6) |
| 23 | Manual top-up: same reference twice; approve own; approve twice; plain admin approves | Refused / idempotent / refused | D (050) | Exists — New: reference reuse across methods |
| 24 | Escrow start while `escrow_enabled` false | `escrow_unavailable`; DB refuses escrow job | D, U | Exists |
| 25 | Withdrawal request while `withdrawals_enabled` false | Refused in the database | D | Exists |
| 26 | Reconcile endpoint without / with wrong secret | 503 when unset, 401 when wrong | U | New |
| 27 | Ledger vs wallets after a full day of the above | `run_financial_reconciliation` ok | D (110) | Exists |
| 28 | Paynow test mode: success, cancel, insufficient funds numbers | Paid → credited once; cancel → cancelled; failed → failed | P | New |
| 29 | Live $1 top-up to the owner's driver account | +$1 once, one ledger line, callback recorded in `payment_events` | L | New (needs approval) |

Required before any provider change or switching on commission collection: rows 1–11 at level I in CI
(un-skip), 14, 21, 22, 26 written and passing, 28 and 29 run with results recorded in
`docs/payments/CURRENT-STATE-AUDIT.md`.
