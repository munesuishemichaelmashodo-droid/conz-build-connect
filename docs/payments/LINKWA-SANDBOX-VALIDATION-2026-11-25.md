# Linkwa sandbox validation — staging rebuild, fixes, evidence (24–25/11/2026)

Branch `feat/linkwa-sandbox-collection` (PR #146, draft, not merged). Production `ovwrsocjmkpiygipmrdk` was read only.

## Verdict: NOT READY for sandbox sign-off

Code, database and staging are in order. No real Linkwa sandbox call has happened yet, because:

1. `SUPABASE_SERVICE_ROLE_KEY` is not set for this branch, so the Preview's server cannot write to staging.
2. This session's network could not reach Linkwa.

Four protocol facts (below) can only be settled by a real sandbox response. After the owner adds the key and runs the checklist at the end, the expected verdict is **SANDBOX READY**.

## 1. Environments

| Item | State | Evidence |
| --- | --- | --- |
| Staging `fpckydgssuefzzxivvig` (conz-staging) | **Rebuilt 25/11** from git commit `9ceaac8` | 148 migrations applied in filename order and recorded in `supabase_migrations.schema_migrations` (148 rows). |
| What staging contains | Same file set as CI | 13/08 baseline + `reference_data.sql` + every later migration. Excluded: test helpers and the parked 0130–0132 and 0137 (not in production's intended state). |
| How it was built | Exact git content | Each file fetched byte for byte from GitHub at `9ceaac8` by `staging_tools.apply_file` (owner-only). |
| What was deleted first | Staging only | Old Payonify-era `public` schema, 7 cron jobs, 4 `@example.com` test users. The 3 old files in Storage are still there: delete them in the dashboard. |
| Staging vs CI-built database | Identical schema | Tables 78, columns 793, constraints 361, indexes 209, triggers 98, policies 144, storage policies 10, settings 19, cron 7. All 333 function bodies identical (md5 without comments/whitespace). Functions callable by anon (54) and authenticated (195) identical. |
| Known difference from the local CLI | Platform default, not drift | `service_role` gets EXECUTE/table rights from the hosted platform's default privileges. Staging matches production on 73 of 78 common tables. |
| Production grant drift (owner to review) | Not in git | `admin_audit_log`, `job_evidence`, `wallets` and `wallet_transactions` have grants that differ from git. `driver_public_profiles` differs because 0170 is not live. |
| Staging switches | Safe | `payment_provider="linkwa"`; escrow, withdrawals, payouts and promo credit OFF; commission 7. |
| Staging push trigger | Disabled | `trg_send_push_on_notification` posts to production's `send-push`, so it is disabled on staging. |
| Staging reconciliation | OK | `financial_reconciliation()` 17/17 OK. |
| Vercel branch variables (Preview, this branch only) | Set | `SUPABASE_URL`, `VITE_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` → staging; `LINKWA_MODE`, `LINKWA_API_KEY`, `LINKWA_WEBHOOK_SECRET`. |
| Paynow on this branch | Blanked 25/11 | `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` set blank for this branch, so the staging-pointed Preview cannot use the live Paynow merchant. |
| Missing branch variable | **Blocker** | `SUPABASE_SERVICE_ROLE_KEY`. The server client throws without it, so start payment, return check and webhook all fail (500, nothing applied). |
| Preview deployment `dpl_CmF9LcoJok2PjSzAPv1jjuzjjQ8A` (`9ceaac8`) | READY | Browser bundle `client-*.js` uses `https://fpckydgssuefzzxivvig.supabase.co` with the staging public key. |
| Production | Untouched | 183 history rows, latest `20261111120000`, no 0171/0175 tables, escrow/withdrawals off, reconciliation all OK (read-only check, 25/11). |

## 2. Payment flows and who owns each step

| Flow | Status | Create | Confirm | Money records | Idempotency | Recovery |
| --- | --- | --- | --- | --- | --- | --- |
| Paynow wallet top-up | Live, unchanged | `paynow.functions.ts` | IPN `api/public/paynow-ipn.ts` + poll | Wallet credit, `apply_paynow_result` | Payment row state machine | cron `paynow-reconcile` → `/api/internal/paynow-reconcile` |
| Direct-to-driver job | Live, unchanged | `accept_bid` → `hold_job_commission` (7% of `final_price` from the driver's credit) | Delivery PIN + evidence → `complete_job` → `settle_direct_pay_job` | Wallet | Job state | Release on cancel |
| Provider-paid job | Built, OFF in production | `startLinkwaSandboxPayment` → `create_provider_job_payment` (one open payment per job) → `provider_claim_payment_link` → Linkwa `POST /payment-links` → `provider_record_payment_link` | Webhook `api/payments/webhook/$provider` → `handleProviderWebhook` (HMAC, then server-to-server status) → `apply_provider_link_payment` → `apply_provider_payment`. Return page → `verifyLinkwaReturn` → same functions. | `provider_clearing` / `job_funds_unsettled` on payment. `complete_job` → `settle_provider_job` writes `driver_payables` + `driver_payable` / `platform_revenue` lines. | Event dedupe on (provider, event id); identifiers write-once (`provider_payment_refs`) | See gaps below |

Cancellation: `tg_jobs_provider_cancelled`. An unpaid payment becomes cancelled; a paid one becomes `refund_due` (refund owed), and admins are notified.

Refund after settlement: `admin_reverse_provider_settlement`. Refund after payout: 0173.

Payouts: none. The Linkwa adapter's payout status always answers "unknown".

## 3. Defect fixed (commit `f0faa8d`)

**D1 (High): a delayed status lost a paid customer's webhook.**

- **Cause.** Linkwa's webhook can arrive before its status endpoint reads PAID. 0175 handed the "pending" answer to 0171, which recorded the event id `payment.completed:<ref>`. The webhook then answered 200, so Linkwa stopped retrying, and any retry came back as `duplicate`.
- **Effect.** The payment stayed `initiated` unless the customer returned to the return page, and the driver could not start the trip.
- **Fix.** `apply_provider_link_payment` returns `pending_no_change` without recording an event, and `handleProviderWebhook` answers **503 `status_pending`**. Linkwa retries 5xx, so a later retry applies the payment once. 0175 was edited in place because it is applied nowhere but CI and staging.
- **Tests.**
  - pgTAP `1095_provider_link_pending_retry` (20 checks). Before the fix, checks 2, 5, 6 and 7 failed (the retry returned `duplicate`; the payment stayed `initiated`). After the fix, 20/20 pass.
  - Unit: "still pending at Linkwa: answers 503" failed before the fix and passes after.

Paynow and wallet code are unchanged. Files touched: `provider.server.ts`, 0175, two tests.

## 4. Test evidence

| Test | Evidence class | Result |
| --- | --- | --- |
| Full pgTAP, CI migration set (local Docker, `supabase/postgres:17.6.1.156`) | Executed, passed | 105 files, 2,201 checks, 0 failures |
| `npm test` | Executed, passed | 100 files: 1,010 passed, 9 skipped (not added by this work) |
| `npm run typecheck`, `npm run lint:security` (exit 0), `npx eslint` on changed files, `npm run build` | Executed, passed | — |
| Linkwa unit tests (documented payloads, HMAC, guard) | Executed, passed | 40/40 |
| Full $400 lifecycle on the **staging database**, provider answers simulated in SQL (no Linkwa call) | Verified by simulation | See below |
| Real Linkwa sandbox calls (7 phone scenarios, OTP 000000/111111) | **Blocked** | No branch service-role key; no network from this session |
| Webhook security via HTTP against the Preview (bad/missing signature, modified body, …) | **Blocked** | Same reason. The same cases pass as unit tests against `handleProviderWebhook`. |

Staging lifecycle (`staging_tools.lifecycle_400()`): job `1d4a2ed2-3d21-4445-8648-c55476c0e24e`, payment `d735384e-33c8-48bf-8f77-1370ed0462d1`. Test users are `lc-customer@`, `lc-driver@` and `lc-admin@example.com` (no password).

Results, in order:

- **Accept:** `final_price` 400.00, `payment_method` provider.
- **Same job again:** asking for a second payment returns the same payment.
- **Pending webhook** → `pending_no_change`.
- **Failed attempts:** insufficient funds → `attempt_failed`; buyer cancelled → `attempt_cancelled`; timeout → `attempt_expired`.
- **Mismatches:** wrong amount 399.99 → `rejected_amount`; wrong currency ZWG → `rejected_currency`; unknown link → `rejected_unknown_link`; another payment's link → `rejected_link`.
- **Unmapped word:** "COMPLETED" → `unknown_status_flagged`.
- **After all of the above:** payment `initiated`, 0 ledger lines.
- **The delayed webhook retried as PAID** → `applied_paid`.
- **Repeats:** the same webhook again → `duplicate`; the return-page check → `already_paid`; a second paid attempt on the same link → `second_payment_flagged`.
- **Ledger:** exactly one receipt, 400.00.
- **Completion with delivery PIN:** job `completed`, commission 28.00. `driver_payables` gross 400.00 / commission 28.00 / driver 372.00. `platform_revenue` 28.00 in one line. Payment `released`.
- **Driver's commission credit:** balance, held amount and transaction count unchanged. 0 payouts.
- **Reconciliation:** 17/17 OK.

One correction: the fixture first set the driver's credit to $50 without a ledger line, which reconciliation flagged. It was reset to 0.

## 5. Open questions only a real sandbox response settles

| # | Question | Risk if wrong | Behaviour today |
| --- | --- | --- | --- |
| Q1 | Is the status `amount` gross or **net** of Linkwa's fee? | High: every real payment would be refused as `rejected_amount` | Exact match with `final_price` is required; any difference is flagged, never credited |
| Q2 | Which word does the status endpoint return on success: `PAID` or `COMPLETED`? | Medium | Only `PAID` counts; `COMPLETED` is flagged |
| Q3 | Is the webhook `reference` the same as the status `payment_reference`? | Medium: the webhook path would never apply | The return page still confirms |
| Q4 | Is `short_url` the last path segment of `checkout_url`, and is the created link's `amount` a JSON number? | Medium: link creation would be refused after Linkwa created it | Refused; the customer sees an error |

## 6. Blockers and risks

| Grade | Item |
| --- | --- |
| Critical (blocks sandbox testing) | Branch `SUPABASE_SERVICE_ROLE_KEY` missing (owner: Supabase dashboard → conz-staging → Project settings → API → service_role → Vercel, Preview, branch `feat/linkwa-sandbox-collection`, Sensitive) |
| High | Q1 (gross vs net) is unproven |
| High | No automatic recovery when neither a webhook nor the customer's return reaches ConZ: the payment reference is unknown, so nothing can ask Linkwa (and Linkwa forbids polling balance/statement). The ConZ sandbox app showed "0 webhooks (polling restricted)". Needs webhooks on the Linkwa plan, or an admin "check payment by reference" tool. |
| Medium | Q2–Q4 |
| Medium | Two links can exist for one payment if recording a created link fails, because the claim expires after 2 min. The first link is never shown to the customer. |
| Low | Delete the 3 old staging Storage files; drop `staging_tools` and the `http` extension on staging once rebuilds are no longer needed |
| Low | Production grant drift on 4 tables (section 1) |

## 7. Owner checklist for the real sandbox run (after the key is set and the branch redeploys)

1. Confirm the Linkwa dashboard has "Immediate Auto-Payouts" **Disabled**.
2. Sign up on the Preview as a customer, and separately as a driver. Admin-approve the driver on staging.
3. Book with "Pay online with Linkwa (sandbox test)" at $400. Accept the offer, then press Pay.
4. Pay on Linkwa with 0788687707 / OTP 000000. Then repeat with a new job for 0711000001, 0711000000, 0712000000, 0713000000, 0714000000, 0715000000 and OTP 111111.
5. After each one, run on staging:
   ```sql
   select outcome, reported_status, reported_amount, reported_currency
     from provider_payment_events order by created_at;
   select * from provider_payment_refs;
   select status from payments;
   ```
   Note `reported_amount` (Q1) and the status word (Q2).
6. Complete one paid job. Check `driver_payables` = 28.00 / 372.00 and that `financial_reconciliation()` is all OK.
