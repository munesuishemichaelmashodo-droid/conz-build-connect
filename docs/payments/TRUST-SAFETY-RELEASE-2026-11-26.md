# Trust and safety release: customer payment record, safety reports, chat warnings (26/11/2026)

Branch `ccr-0fcdaf2a-t5bmjg` (from `main` @ `471d9a7`). Scope fixed by the owner's "ConZ Final Implementation and
Launch Prompt" (26/11). Status: **IMPLEMENTATION COMPLETE — READY FOR PRODUCTION APPROVAL** (code and tests);
nothing deployed, 0178 not applied.

## 1. What was already working (verified in code, tests and production reads)

| Area | Evidence |
| --- | --- |
| Commission credit: reserve 7% at acceptance, block if short, charge once at verified completion, release once on cancel, no race to a negative balance | `accept_bid` → `driver_can_accept_for` → `hold_job_commission`; `settle_direct_pay_job` charges the held amount (0113, live); per-driver advisory lock; pgTAP 240/440/1100, staging launch suite and 4 concurrency races (25/11) |
| Wallet screen: available / held / promotional credit / top-ups / history | `wallet.tsx` (promo credit shown separately, never as cash) |
| Paynow top-ups: hash-checked callback, reference = payment id, exact amount, idempotent credit, duplicate/late handling, reconcile poll | `paynow.server.ts`, `apply_paynow_result`, `credit_wallet_from_payment`; unit + DB tests |
| Driver confirms a direct payment once; honest receipts | 0176 (live), PR #147 (live 25/11) |
| Contact and address privacy before selection; masked job view; bidder exposure closed | 0133, 0153 (live); production probe 04/11 |
| Delivery evidence: photo + customer PIN, pickup GPS check, route trail, disputes with evidence, agreements with deposit rules | 0096, 0112, 0157, 0162/0163 (live) |
| Shared tracking link: unguessable token; cancelled jobs show nothing; completed jobs expire after 90 days | `get_public_tracking` |
| Offline contact card cleared at job end and sign-out, 7-day cap | `offline-card.ts`, `sign-out.ts` |

## 2. What changed (this branch)

| Change | Files |
| --- | --- |
| **Customer's side of a direct payment.** The customer can record "I paid the driver" (method, amount, reference) and agree with the driver's confirmation. Both are write-once statements, readable only by the job's two parties and admins. Mismatches against the agreed price or the driver's amount alert admins. Commission is never touched. The job panel shows one of five stages: no payment recorded yet → customer says paid → driver confirmed → customer agreed → disputed | `0178` (DB), `DirectPaymentPanel.tsx`, `direct-payment.ts` |
| **Safety, fraud and harassment reports.** A category on every report. Safety, fraud and harassment are marked urgent and notify every admin at once. The report screen says first: call the police (995) or emergency services (999); Con Z is not an emergency service and does not watch trips live. Admins see the category and an "Urgent" badge, urgent reports first | `0178`, `report.tsx`, `admin.reports.tsx`, `report-categories.ts` |
| **Chat safety.** A one-line rule at the top of every chat ("pay only this job's driver, as agreed") with a report link. A warning under the *other person's* message when it asks for money early, for payment to someone else, or to deal outside Con Z. Nothing is blocked; phone numbers and addresses still work | `chat.$jobId.tsx`, `chat-safety.ts` |
| **`payments.paid_at`** is now set when a payment becomes paid (audit finding P-4) | `0178` |

## 3. Tests actually run (26/11, local)

| Command | Result |
| --- | --- |
| pgTAP `1120_direct_payment_customer_side` on a fresh local DB (baseline + every migration + 0178) | 26/26 |
| Full pgTAP suite (`/tmp` psql runner over `supabase/tests/database/*.sql`) | 105 files, 2,175 checks, 0 failures |
| `npx vitest run` | 102 files passed (1 skipped), 994 tests passed |
| `npx tsc --noEmit` | clean |
| `npm run lint:security` | exit 0 |
| `npx eslint` on the new files | exit 0 |
| `npm run build` (includes the compiled-server smoke test) | passed |

**Not run:** a browser click-through of the new panel, report form and chat warning; staging end-to-end (staging paused at the owner's request 26/11); any real phone.

## 4. Payments: Paynow and the four uncredited payments ($22)

- **Uncredited payments.** The four payments (987bbfc8 / 15e6c978 / 8f3b2513 / 2b6d59f2; Paynow 57160075 / 57160185 / 57200026 / 57203065) **no longer exist in production**. The pre-launch wipe (10/11) removed every payment row, and the in-database snapshot `backup_20261110` has since been dropped. Production now holds one payment row (24/11). Nothing was credited or changed.
  - To settle them, the owner needs Paynow's own transaction report for those four Paynow references. If any shows as paid to Navysky, the driver's credit can be restored through the existing audited admin adjustment, with the Paynow report as evidence.
  - Never credit them without that report.
- **Bank settlement: unverified.** No evidence in the repository or the database shows:
  - Navysky's Paynow merchant verification;
  - its nominated bank account;
  - Paynow's current fees or settlement timing;
  - BuySafe status (finding P-11);
  - a settled transaction.

  Last successful Paynow top-up: 13/08. No callback recorded since 09/10.

## 5. Open risks

| Risk | Owner action |
| --- | --- |
| Paynow live state, BuySafe and bank settlement unverified (P-1, P-2, P-11) | Confirm with Paynow: merchant status for Navysky Innovations, settlement account, fees, BuySafe off. Set `PAYNOW_RECONCILE_SECRET`. Then one authorised $1 top-up, checked on the bank statement |
| Prepaid commission credit may be "stored value" | Lawyer review (`docs/marketplace/CONZ-COMMISSION-CREDIT-RISK-NOTE.md`) |
| Emergency numbers on the report screen (995 police, 999 emergency) | Owner to confirm they are the right numbers to show |
| Chat warnings are pattern-based | They will miss some messages and occasionally warn on an innocent one; they never block anything |

## 6. Production

Nothing deployed and no migration applied. To release, with the owner's go:
1. Merge the PR (Vercel deploys the app; it works with or without 0178).
2. Apply 0178 via `execute_sql` (no DROP or DELETE), record it as `20261126100000`, then check:
   - the table and functions exist;
   - RLS is on;
   - a report with category `general` can be inserted and read back.
