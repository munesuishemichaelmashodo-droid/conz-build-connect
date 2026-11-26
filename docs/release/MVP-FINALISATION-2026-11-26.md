# ConZ MVP finalisation: release report (26/11/2026)

**Status: READY FOR PRODUCTION APPROVAL.** The code and tests are complete. Nothing has been merged or deployed, and
migrations 0178/0179 are not applied. Paynow bank settlement is **unverified**.

- Branch: `ccr-0fcdaf2a-t5bmjg` = production `main` (`471d9a7`) + 5 commits:
  - `1d85532`, `b547bd2`: trust and safety;
  - `224700d`: commission wallet;
  - `e7fb299`: agreement and payment stages;
  - `94d6ef9`: job page and admin.
- Main and the branch were reconciled before starting. The branch was main plus this session's work only; nothing
  was overwritten.

## 1. What was already working (checked in code, tests and production reads; not rebuilt)

| Area | Evidence |
| --- | --- |
| **Commission flow:** 7% of the agreed job price reserved at acceptance (blocked if short), charged once at verified completion, released once on cancellation; no race to a negative balance | `accept_bid` → `driver_can_accept_for` → `hold_job_commission`; `settle_direct_pay_job` (0113, live); per-driver lock. pgTAP 240/440/1100 pass; staging suite and 4 concurrency races passed 25/11 |
| **Paynow top-ups:** hash-checked callback, reference = payment id, exact amount, idempotent credit, duplicate/late/failed/cancelled handling, ledger + audit | `paynow.server.ts`, `apply_paynow_result`, `credit_wallet_from_payment`; unit + DB tests |
| Cash vs promotional credit kept apart; promo is not cash | 0134 (live), wallet screen |
| Contact/address privacy before selection; masked jobs; bidder exposure closed | 0133, 0153 (live) |
| Chat limited to the job's two parties | Existing RLS (0084/0133) |
| Delivery photo + customer PIN; pickup GPS check; route trail; disputes with evidence | 0096, 0110, 0112 (live) |
| Tracking link: unguessable token; nothing after cancellation; expires 90 days after completion | `get_public_tracking` |
| Driver verification and 90-day re-check | Enforced in the database |
| Agreement versions; driver-only deposit | 0157/0162/0163 (live) |
| Admin step-up on money/role actions; audit log | 0111, 0166, 0169 |

## 2. What changed

| # | Change | Files |
| --- | --- | --- |
| 1 | **Commission wallet** renamed "ConZ Commission Credit" | `wallet.tsx`, `profile.tsx`, `src/lib/commission-wallet.ts` |
| | • Removed: Withdraw button, withdrawal dialog, withdrawal PIN card, PIN recovery, the "driver earnings" card | |
| | • Added: the 7% rule and when credit becomes available, Paynow reference per top-up, a printable receipt (Navysky, amount, date, Paynow ref, receipt no.), readable history labels | |
| | • Kept: past withdrawal records, read-only | |
| 2 | **Agreement payment terms** (0179) | `AgreementCard.tsx`, `src/lib/agreement.ts` |
| | • New fields: name and number the customer pays, payment instructions, when the deposit is due and why, cancellation/refund terms | |
| | • Exact method: cash, EcoCash, OneMoney, InnBucks, ZIPIT, bank transfer, other | |
| | • Supports no deposit, deposit + balance, full advance, payment after delivery | |
| | • The driver sets deposit and payment details; a customer counter-proposal cannot change where the money goes | |
| 3 | **Per-stage direct payments** (0179) | `DirectPaymentPanel.tsx`, `src/lib/direct-payment.ts`, `jobs.$id.tsx` |
| | • Deposit / balance / full payment are separate records | |
| | • Each has the customer's claim, the driver's confirmation and the customer's agreement; write-once, with append-only history | |
| | • Visible only to the two parties and admins; mismatches alert admins; commission never changes | |
| | • Shown on the active job (so deposits are recorded before delivery) and on completion | |
| 4 | **Safety reports** (0178) | `report.tsx`, `admin.reports.tsx`, `src/lib/report-categories.ts` |
| | • Categories; safety/fraud/harassment are urgent and alert every admin | |
| | • "Call 995 / 999 first; Con Z is not an emergency service" | |
| | • Admins see category and an Urgent badge | |
| 5 | **Chat safety**: a one-line payment rule, a report link, a warning under messages asking for money early, payment to someone else, or a deal outside Con Z (never blocks) | `chat.$jobId.tsx`, `src/lib/chat-safety.ts` |
| 6 | **Admin dispute panel**: "Agreement and payments" section with both parties' statements and history | `DisputeEvidence.tsx`, `DisputePayments.tsx` |
| 7 | `payments.paid_at` set when a payment becomes paid (audit finding P-4) | 0178 |

Migrations (no DROP, no DELETE; undo scripts in `supabase/rollbacks/`):
- `20261126100000_0178_safety_reports_and_paid_at.sql`
- `20261126110000_0179_agreement_payment_terms_and_stages.sql`

## 3. Tests actually run (26/11)

| Command | Result |
| --- | --- |
| pgTAP, full suite on a fresh local DB (13/08 baseline + every migration + 0178 + 0179) | **106 files, 2,189 checks, 0 failures** |
| — of which `1120_safety_reports_paid_at` | 6/6 |
| — of which `1130_agreement_terms_payment_stages`: four plans, who may write what, payment-detail privacy, write-once, append-only history, mismatch alert, commission untouched | 34/34 |
| `npx vitest run` | 103 files, 1,002 tests passed |
| `npx tsc --noEmit` | clean |
| `npm run lint:security` | exit 0 |
| `npx eslint` on new/changed files | exit 0 for new files; `wallet.tsx` keeps its 20 older format errors (none new); `profile.tsx` 77 → 55 |
| `npm run build` (incl. compiled-server smoke test) | passed |

The tests caught one real bug in my own code during the work. The payment-plan check used `current_user`, which is
always the owner inside a SECURITY DEFINER function, so anyone could read a job's payment plan. Fixed, with tests
8–9 in 1130.

**Browser walkthrough.** Headless Chromium as a Pixel 5 phone, against the repo's local mock backend; screenshots in
the session.

| Journey | Result |
| --- | --- |
| Driver wallet | Titled "ConZ Commission Credit"; no Withdraw button; rules show "not your earnings", "cannot be withdrawn", "7%" |
| Profile | No withdrawal PIN card |
| Report | Opened from a fraud link: category preselected; 995/999 note shown |
| Customer active job | Agreement card and payment panel shown |
| Chat | Safety note shown |
| Deposit flow (customer, then driver, then customer) | Customer records the $50 deposit → status "Customer says paid" → driver confirms → "Driver confirmed" → customer agrees → "Driver confirmed and customer agreed"; the balance stays a separate, unrecorded stage; history shows 3 entries |
| Page errors | 0 |

**Not done:**
- a real phone or the Android app;
- staging end-to-end (staging paused, owner's request);
- a real Paynow payment;
- a screen reader.

The mock backend has no database rules; those are covered by pgTAP.

## 4. Paynow readiness (commission top-ups only)

| Item | Finding |
| --- | --- |
| Code: hash check, idempotency, duplicates, late/failed/cancelled, ledger | Present and tested (see section 1). No defect found, so not rebuilt |
| Production credentials | `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` are set in Vercel Production (values not read). A $4 top-up started on 24/11 got a real Paynow answer ("Created", poll URL), so the credentials are accepted |
| **Automatic re-check (P-1): broken in practice** | The `paynow-reconcile` job runs every 10 minutes and reports "succeeded", but the 24/11 payment was checked only once in two days. `app_secrets` has no reconcile URL/secret, and Vercel has no `PAYNOW_RECONCILE_SECRET`. Stuck top-ups are re-checked only when the driver opens the wallet |
| BuySafe (P-11) | Unknown. Paynow's BuySafe holds funds until delivery is confirmed unless the merchant is verified and turns it off. With it on, a driver could be credited before ConZ is actually paid |
| Merchant approval, company details, settlement bank account, fees, settlement timing, reversals | **No evidence in the repository or database.** Must come from Paynow and the bank |
| Last successful live top-up | 13/08/2026 |
| The $22 of uncredited payments (4 transactions) | Rows no longer exist (pre-launch wipe 10/11). Settle only against Paynow's own report for refs 57160075 / 57160185 / 57200026 / 57203065 |

**Bank settlement status: UNVERIFIED.**

## 5. Open risks

| Risk | Note |
| --- | --- |
| Paynow settlement, BuySafe, automatic re-check | Section 4 |
| Terms and Privacy still mention withdrawals and a withdrawal PIN (`terms.tsx` sections 6–7, `privacy.tsx`) | Legal text, left unchanged for the owner's lawyer. The app no longer offers withdrawals |
| Prepaid commission credit may count as stored value | Lawyer (`docs/marketplace/CONZ-COMMISSION-CREDIT-RISK-NOTE.md`) |
| Payment statements are the parties' word only | By design; never shown as proof. Screenshots are not accepted as proof |
| Chat warnings are pattern-based | May miss or over-warn; never block |
| Leftover Payonify variables in Vercel Preview | Owner removes (Payonify retired) |

## 6. Production (nothing done; needs the owner's go)

1. **Approve and merge** the PR from `ccr-0fcdaf2a-t5bmjg`. Vercel deploys the app; it works without 0178/0179 (panels
   fall back or hide).
2. **Apply 0178, then 0179**, via `execute_sql` (neither has DROP or DELETE). Record them as `20261126100000` and
   `20261126110000`. Then check that:
   - the tables, functions and RLS are in place;
   - a test insert into `reports` with a category works;
   - `job_payment_plan` is refused to a non-party.
3. **Smoke-test on production:**
   - wallet page;
   - agreement with a deposit on a real test job;
   - deposit claim → confirm → agree;
   - safety report reaches admins.

## 7. Needs the owner or Paynow

1. **Paynow:**
   - written confirmation of Navysky Innovations' merchant status, settlement bank account, fees and settlement days;
   - BuySafe turned off for top-ups;
   - permission to use Paynow for ConZ's own commission top-ups.
2. **Set the reconcile secret:** `PAYNOW_RECONCILE_SECRET` in Vercel Production plus the matching `app_secrets` rows,
   so stuck top-ups are re-checked automatically.
3. **One authorised $1 top-up**, matched against the business bank statement.
4. **Paynow's report** for the four old references (the $22).
5. **Lawyer:** Terms/Privacy withdrawal wording; commission credit as stored value; confirm the 995/999 numbers.
6. **Approval** to merge and to apply 0178/0179.
