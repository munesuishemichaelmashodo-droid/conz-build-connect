# ConZ launch payment system: direct pay with commission credit (25/11/2026)

**Launch model:**
- Customers pay drivers directly.
- Drivers keep prepaid ConZ commission credit, topped up through Paynow.
- ConZ earns 7% of the final accepted deal (materials plus transport). It is reserved when the deal is accepted and charged once at completion.
- Linkwa stays sandbox-only (PR #146).

Production was read-only throughout; only read queries were run against it.

## 1. What actually exists (inspected, not assumed)

| Step | Owner (database unless noted) | What it does |
| --- | --- | --- |
| Top-up starts | `paynow.functions.ts` → `initiatePaynowTransaction` | Creates a `payments` row (`type = topup`, `status = initiated`); its id is the Paynow reference. |
| Paynow confirms | `api/public/paynow-ipn.ts` → `processPaynowIpn` → `apply_paynow_result` | Refuses an unconfigured server (503) or a bad hash (401), checked with the integration key. The reference must equal the payment id and the amount must match exactly. Then: `credited`, `duplicate_ignored`, `closed_unpaid`, `late_success_flagged` (never auto-credited), `regression_blocked` or `reversal_flagged`. Every call is written to `payment_events`. A Paynow reference can belong to one payment only (`payments_paynow_ref_key`). |
| Recovery | cron `paynow-reconcile` → `/api/internal/paynow-reconcile` | Polls pending Paynow payments through the same `apply_paynow_result`. |
| Credit | `credit_wallet_from_payment` | USD only. Once per payment: wallet `+amount`, a `wallet_transactions` row, a ledger entry (`paynow_clearing` / `user_wallets`), a `wallet_audit_log` row and a notification. |
| Acceptance | `accept_bid` / `accept_counter` / `accept_dispatch_offer` → `driver_can_accept_for` → `hold_job_commission` | `final_price` = the accepted bid's price. Available credit is `balance − held − withdrawal_reserved + promo`; the acceptance is refused if it is below `commission_amount(final_price)`. On success it reserves `held += 7%`, taking promotional credit first. |
| One job per driver | trigger `tg_one_active_job_per_driver` | Per-driver advisory lock, then the "already on a job" check. This serialises acceptances for the same driver. |
| Price after acceptance | trigger `tg_jobs_money_columns_guard`; `raise_job_budget` is for open jobs only | Clients can't change `final_price`, `commission` or `held_commission`. |
| Cancellation | `cancel_job` → `release_job_commission` | Releases the hold; nothing is charged. A driver cancelling before pickup reopens the job (0145). |
| Completion | `complete_job` (PIN + delivery evidence) → `settle_direct_pay_job` | Charges exactly the amount reserved at acceptance, once: `wallet_transactions` `commission`, ledger `direct_commission` (`user_wallets` → `platform_revenue`), `jobs.commission`. A second call returns `already: true`. |
| Disputes | `raise_dispute`, `resolve_dispute` (0160) | A refund on a direct job returns the commission to the driver's credit. Wallet credits need a **super admin**. |
| Admin adjustments | `admin_wallet_adjust` / `admin_apply_wallet_change` / `admin_wallet_reverse` | Step-up plus daily caps (0076/0124). These were not changed. |
| Rounding | `commission_amount` | `round(price × rate / 100, 2)`, half away from zero; the app uses the same rule (`driver-economics.ts`). |

**Records kept apart:**

| Record | Where it lives |
| --- | --- |
| Commission credit | `wallets` / `wallet_transactions` |
| Customer-to-driver payment evidence | `direct_payment_confirmations` (new, 0176) |
| ConZ commission earned | `platform_ledger.platform_revenue` and `jobs.commission` |
| Paynow fees | Not recorded by ConZ |
| Provider-collected payments | `provider_*` and `driver_payables` (0171, off and not used by direct pay) |

No `driver_payables` row is created for a direct job (checked in the suite).

**Production vs git:** 41 of the 48 functions involved have identical bodies on production and staging. The other seven are 0171's (not live on production). Diffing production's versions against git's shows the only changes are added `payment_method = 'provider'` branches and a provider refund state. The direct-pay logic is identical, so the staging results below apply to production's direct path. (Evidence class: verified by function-body diff, not by re-running the suite on production versions.)

## 2. Defects found and fixed

| # | Object | Problem | Fix | Evidence |
| --- | --- | --- | --- | --- |
| D1 | `tg_retire_free_first_job` | The free first job was retired (09/11) only while `promo_credit_enabled` was on. Switching promo off would give every new driver a commission-free first job ($0 reserved and charged on a $400 job). | **0176**: always mark new profiles used, and mark any leftovers used. Production has 0 leftovers. | pgTAP 1100: without 0176, checks 1–2 fail ($0 reserved); with it, $28. pgTAP 240/440/970 updated to the retired rule. |
| D2 | Receipts (`track.$token.tsx`, PDF, completion screens) | A direct job said "Total paid" and "Paid directly to driver" with no evidence that the driver was paid. | **0176** `direct_payment_confirmations` + `driver_confirm_direct_payment` (immutable, once per job, parties and admins only, never changes commission, admins alerted if the amount differs). Screens show: agreed price; "Paid directly to the driver (not handled by Con Z)"; "Driver confirmed receiving it on … : $X by EcoCash, reference …" or "Not confirmed by the driver"; dispute status. The public receipt shows only the confirmation date and method. Nothing says "verified". | pgTAP 1100 (20); unit `direct-payment` (6) |
| D3 | `pod.functions.ts`, `jobs.$id.tsx`, `track.$token.tsx` | Linkwa-paid jobs were described as "Paid directly to driver". | Shared wording helper `payment-method-copy.ts` | unit `payment-method-copy` (4) |
| D4 | `wallet.tsx` "Held" text | With promo off it promised "your first completed job has no commission". | Removed | typecheck/build |

**Not changed, reported:**
1. Resolving a "refund" dispute on a direct job needs a super admin: an ordinary admin gets "Only a super admin can credit a wallet" and the resolution rolls back. This is consistent with the two-tier money rule, but the admin screen should explain it.
2. A second `complete_job` call is a quiet no-op (`already: true`), not an error. It is safe, because nothing is charged twice.

## 3. Migration required

**0176 `20261125100000_direct_pay_launch`** (not applied to production; applied to staging 25/11 from commit `902231d`, recorded).
- No DROP, no DELETE. It is independent of 0171–0175.
- Production before: `tg_retire_free_first_job` `a64d6f52`, 0 unused free jobs, promo on, no confirmations table.
- After (staging): `803f4c68`, `driver_confirm_direct_payment` `5180a7fa`.
- Undo: `supabase/rollbacks/20261125100000_0176_rollback.sql`.
- Apply step 8 in `supabase/maintenance/20261124_MIGRATION_STATUS.md`.
- The app copes with 0176 missing: the confirmation panel hides itself, and receipts say "Not confirmed by the driver".

## 4. Tests: what ran and how

### Staging launch suite (`staging_tools.launch_suite()`, 25/11): executed on staging, 13/13 checks pass

Uses the real functions. Users are impersonated with real JWT claims. Paynow results are passed to `apply_paynow_result` the way `processPaynowIpn` passes them after the hash check, so no real Paynow call is made.

| # | Scenario | Result (database records) |
| --- | --- | --- |
| 1 | Top-up $50 | `credited`, wallet 50.00, 2 ledger lines, 1 audit row |
| 2 | Failed top-up | `closed_unpaid`, `failed`, wallet unchanged |
| 3 | Duplicate / late / reversed / wrong amount / wrong reference callbacks | `duplicate_ignored`, `duplicate_ignored`, `late_success_flagged`, `regression_blocked`, `rejected_amount_mismatch`, `rejected_reference_mismatch`; one top-up transaction |
| 4 | Insufficient credit | "needs $28.00, has $0.00 available"; job stays open; nothing held |
| 5 | Accept $400 (materials $300 + transport $100) | held_commission 28.00; wallet balance 50.00, held 28.00, available 22.00 |
| 6 | Customer cancels | cancelled; held 0.00; balance 50.00; no commission transaction |
| 7 | Delivery + PIN | completed; commission 28.00; balance 22.00; one −28.00 transaction; platform_revenue 28.00 |
| 8 | Completion again (customer and driver paths) | no second debit; one commission transaction, one revenue line; jobs_completed unchanged |
| 9 | Second acceptance for a busy driver | `DRIVER_BUSY`; one $7 reservation |
| 10a | Change price after acceptance | Direct edit refused (money-column guard); `raise_job_budget` refused; final_price and reservation unchanged |
| 10b | Counter $300 → $250, then accepted | final_price 250.00; reserved 17.50 (7%) |
| 11 | Dispute refund on a completed $250 job (super admin with fresh TOTP) | Driver credit 4.50 → 22.00 (+17.50); second resolution "Already resolved" |
| 12 | Reconciliation | 17/17 checks OK; driver wallet = sum of its transactions |

### Truly concurrent attempts (two live connections, local CI database, 25/11): executed, pass

| Race | Result |
| --- | --- |
| One driver accepted on two jobs at once | One accepted, the other `DRIVER_BUSY`; held 7.00 (one reservation) |
| The same offer accepted twice at once | One accepted, the other "Job not open"; held 7.00 |
| The same job completed twice at once | Second returned `already: true`; one −7.00 commission |
| The same Paynow IPN twice at once | `credited`, `duplicate_ignored`; balance +20 once; one top-up transaction |

### Automated suites

| Suite | Result |
| --- | --- |
| pgTAP, full CI set (local Docker), Linkwa branch | 106 files, 2,221 checks, 0 failures |
| pgTAP, launch branch `ccr-0fcdaf2a-t5bmjg` (= `main` + this work) | 104 files, 2,149 checks, 0 failures; unit 980 passed; typecheck, build and `lint:security` pass |
| `npm test` | 1,031 passed, 9 skipped (not added by this work) |
| Typecheck, `lint:security` (exit 0), build | Pass |
| Paynow hash and IPN unit tests (`paynow.server`, `paynow-ipn-db`) | Executed within `npm test` |

### Not executed

- A real Paynow transaction on staging (the staging branch has Paynow keys blanked on purpose).
- The owner-run $1 live Paynow test.
- Clicking through the new confirmation panel in a browser.
- Production.

## 5. Linkwa boundary

- PR #146 stays a draft and sandbox-only. Production `payment_provider = "none"`; payouts, escrow and withdrawals stay off.
- No Linkwa credentials are in shared configuration: only branch-scoped variables on `feat/linkwa-sandbox-collection`.
- **Open question for Linkwa:** can each driver have their own receiving account, and can ConZ safely start a checkout that pays a specific driver's account (account-specific payment links, with ConZ never holding the money)? That would let customers pay drivers online without ConZ collecting customer funds.

## 6. Outstanding

| Grade | Item |
| --- | --- |
| High | Owner approval to apply 0176 to production and merge the launch branch (merging deploys) |
| Medium | Real Paynow check: owner-run $1 test (Paynow has been live since 13/08) |
| Medium | Admin screen: explain that refund outcomes on direct jobs need a super admin |
| Low | Browser and real-device check of the confirmation panel and receipts |

## 7. Verdict

**The direct-payment launch model is ready for production review.** Commission is 7% of the whole accepted deal; it is reserved atomically at acceptance, released on cancellation and charged exactly once, including under real concurrency. Paynow top-ups credit once with full ledger and audit records. Reconciliation is clean.

What remains is the owner's approval to apply 0176 and merge, and the owner-run real Paynow check.
