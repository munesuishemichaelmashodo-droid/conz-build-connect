# Payonify Relay: Con Z Pay integration (sandbox only)

Status 26/10/2026: **built and tested locally, not deployed, not applied.** Branch `payments/payonify-relay`.
Paynow is unchanged and stays the payment option for every customer. Payonify is off everywhere unless a server
is explicitly configured for test mode and is **not** using the production database.

Sources: docs.payonify.com (charges, webhooks, errors, relay, refunds; read 26/10/2026), `PAYONIFY-RELAY.md`
(client notes), `PAYONIFY-MIGRATION-PLAN.md` (wider plan), read-only checks of production's schema.

## 1. What was built

| Part | File | What it does |
| --- | --- | --- |
| Database | `supabase/migrations/20261026150000_0120_payonify_charges.sql` (undo: `supabase/rollbacks/20261026150000_0120_rollback.sql`) | Adds `payments.provider` (default `paynow`), `provider_reference` (charge id), `provider_livemode`; one charge per payment; one open Payonify attempt per job; Payonify for escrow only. `apply_payonify_charge()` is the only place a Payonify result changes a payment. `payonify_webhook_events` keeps events ConZ does not act on. Paynow's 1-hour expiry now skips Payonify rows. |
| API client | `src/lib/payonify.server.ts` | Test keys only. Amount read as `{value, currency}`; `livemode` read as boolean or `"true"/"false"`; 20 s timeout; `isDefinitiveRejection()` separates "refused" from "unclear". |
| Rules + webhook | `src/lib/payonify.process.server.ts` | The on/off gate, the tester list, the production-database refusal, and the webhook handler. |
| Server functions | `src/lib/payonify.functions.ts` | Start a payment, check its status, admin overview, admin "Check with Payonify". |
| Webhook URL | `src/routes/api/payonify/webhook.ts` | `POST /api/payonify/webhook` (the URL saved in the Payonify project). |
| Customer screen | `src/components/payments/PayonifyEscrowPay.tsx`, `jobs.$id.tsx` (Confirm & pay) | "Pay with" choice: Paynow (default) or "EcoCash (Payonify test)", only for listed testers. |
| Admin screen | `src/components/payments/PayonifyAdminPanel.tsx` on Money approvals | Payonify payments, status history, unhandled events, "Check with Payonify". |
| Paynow guard | `src/lib/paynow.functions.ts` | The Paynow pay button refuses to start a second charge while a Payonify attempt is open for the job. |

### Payment flow

1. Customer picks "EcoCash (Payonify test)", enters their number and taps Pay (button disabled while it works).
2. Server checks: gate, tester, Con Z Pay switch, own job, `payment_method = escrow`, job accepted/in progress,
   not already paid, no other open attempt (any provider). Amount = `final_price ?? budget` from the database.
3. Server inserts the payment (`initiated`, provider `payonify`, test mode) **before** calling Payonify, then
   `POST /v1/charges` with `metadata.conz_payment_id`. The charge id is stored as soon as Payonify returns it.
4. Customer approves the EcoCash prompt. The screen shows "Approve the payment on your phone" and checks every
   6 s for 3 minutes, plus a "Check status" button.
5. Payonify sends `charge.succeeded` / `charge.failed`. The webhook verifies the signature, **re-fetches the
   charge from Payonify** and applies that copy. Paid → `mark_escrow_payment_paid()` (same as Paynow: ledger,
   driver told, duplicate/late payments go to refund).

### State mapping (Payonify charge → ConZ payment)

| Payonify status | ConZ when `initiated` | ConZ when already paid/released/refunded | ConZ when failed/cancelled |
| --- | --- | --- | --- |
| `requires_payment_method`, `requires_authorization`, `pending` | stays `initiated` | no change | no change |
| `succeeded` (amount, currency, mode, charge id and metadata all match) | `paid` (escrow held) | no change (`duplicate_ignored`) | no change, admins alerted (`late_success_flagged`) |
| `failed` | `failed` | no change, admins alerted (`regression_blocked`) | no change |
| `cancelled` | `cancelled` | no change, admins alerted | no change |
| anything else | no change (`unknown_status_ignored`) | no change | no change |

Any mismatch (amount, currency, test/live, charge id, metadata, wrong provider) changes nothing and alerts admins.
Every call is written to `payment_events` with its outcome.

### Webhook responses

| Case | Response | Effect |
| --- | --- | --- |
| Payonify not enabled on this deployment / no webhook secret | 503 | Payonify retries later |
| Bad or missing signature, older than 5 min, live event, malformed | 400 | nothing recorded |
| Charge can't be fetched from Payonify | 503 | retried |
| Database error | 500 | retried |
| Repeat of an event already handled | 200 `duplicate_event` | nothing changes |
| Charge for no/unknown ConZ payment, live charge, id mismatch | 200 | recorded in `payonify_webhook_events` |
| Transfer, refund, reversal, payout, checkout events | 200 `recorded_unhandled` | recorded only |

## 2. Environment variables (Vercel or local; never in git, chat or logs)

| Name | Where | Value |
| --- | --- | --- |
| `PAYONIFY_MODE` | sandbox environment only | `test`. Unset = Payonify off (production today). |
| `PAYONIFY_PUBLISHABLE_KEY` | sandbox only | `pk_test_…` from the Payonify dashboard. Live keys are refused by the code. |
| `PAYONIFY_SECRET_KEY` | sandbox only | `sk_test_…`. Server-side only. |
| `PAYONIFY_WEBHOOK_SECRET` | sandbox only | `whsec_…` for the test webhook endpoint. |
| `PAYONIFY_TESTER_USER_IDS` | sandbox only | Comma-separated ConZ user ids allowed to see the option. |
| `SUPABASE_URL` | already set | Must **not** be the production project (`ovwrsocjmkpiygipmrdk`); the code refuses it. |

Nothing is configured anywhere yet. No keys were created, used or stored in this work.

## 3. Tests run (26/10/2026)

| Level | Result |
| --- | --- |
| Unit (`npm test`) | 40 files / 400 tests pass (new: `payonify.process.test.ts`, 16) |
| Database (pgTAP, fresh local Supabase, all migrations to 0120) | 48 files / 1,193 tests pass, including the Paynow suites (new: `520_payonify_charges`, 51) |
| Webhook code against the real database functions (Payonify mocked, fake keys) | `payonify-webhook-db.test.ts` 5/5; Paynow `paynow-ipn-db.test.ts` 9/9. Added to CI. |
| Typecheck, security lint, build + server smoke test | pass |
| Browser, local sample data, 360 px | Option shown to a listed tester; hidden with no Payonify settings; button disabled until a number is entered; Paynow button hidden while EcoCash is selected |

**Not tested:** any call to Payonify's real sandbox (no test keys; Payonify asked for no test transactions before
Relay is activated), a real EcoCash prompt, a real webhook delivery, Android WebView behaviour. No real payment
was made or attempted.

### Paynow regression assessment

- Paynow callback, polling, reconcile, top-ups and escrow are unchanged apart from two guards:
  1. `expire_stale_paynow_payment` / `expire_unsent_paynow_payments`: same bodies plus "Paynow rows only".
     Every production payment is a Paynow row (read-only check: all 40 have `method = paynow`), so behaviour is
     identical. pgTAP checks Paynow expiry still closes Paynow payments.
  2. The Paynow escrow button refuses to start while a non-Paynow attempt is open for the job. No production
     row matches today.
- The Paynow code reads no new column, so the app works the same before and after 0120 is applied.
- All existing Paynow pgTAP and DB-backed callback tests pass.

## 4. Sandbox test plan (needs a non-production database)

Vercel Preview uses the **production** Supabase, so sandbox payments can't run there; the gate refuses it.
Use the local stack (`node scripts/db-test.mjs start`, or the full local Supabase) or a separate staging project.

1. Payonify activates Relay on the project and confirms test transactions are allowed.
2. Create test keys and a test webhook endpoint pointing at a public URL for the sandbox server (a tunnel to
   the local app, or the staging deployment). Store the secret only in that environment.
3. Apply migrations to the sandbox database (0120 included). Set the variables in §2 with one tester's user id.
4. Run each case with Payonify's test numbers (from Payonify's test-data page; re-confirm before use):

| # | Case | Expected |
| --- | --- | --- |
| 1 | Success number | Prompt → `paid`; driver notified; ledger `escrow_paid` once; webhook `escrow_marked_paid` |
| 2 | Same webhook re-sent from the dashboard | `duplicate_event`, nothing changes |
| 3 | "Cannot receive" number | `failed`; customer sees "didn't go through"; can try again |
| 4 | Timeout number | Stays pending; "Check status" works; final webhook settles it |
| 5 | Unregistered number | Refused at start (`payment_declined`) or `failed`; nothing paid |
| 6 | Tap Pay on two devices at once | One attempt; the other gets "Another payment … is still open" |
| 7 | Paynow chosen while a Payonify attempt is open | Refused |
| 8 | Webhook with a wrong secret | 400, nothing recorded |
| 9 | Customer cancels the job after paying | `refund_due`; admin refunds in the Payonify dashboard, then records it |
| 10 | Non-tester account | No Payonify option |

Record each case's charge id, ConZ payment id and outcome. Only after all pass: owner decides on live.

## 5. Production readiness checklist

- [ ] Owner approves the money model (`PAYONIFY-MIGRATION-PLAN.md` §6: who pays fees, payout timing, direct pay).
- [ ] Lawyer/accountant view on ConZ holding customer funds.
- [ ] Company bank account; Payonify KYC approved; Relay activated.
- [ ] Sandbox plan §4 passed on a non-production database.
- [ ] Owner approves applying 0120 to production (no DROP; undo script ready; apply in the SQL editor or MCP,
      then record it and commit in the same sitting).
- [ ] Live mode is a **code change**, not a setting: today the code refuses live keys and the production
      database. Enabling live needs a reviewed PR that adds a live mode, separate live keys and webhook secret in
      Vercel Production only, and a written owner approval.
- [ ] Payouts to drivers (Relay transfers) built: not in this work (see blockers).
- [ ] Owner-run small live payment and refund before opening to customers.

## 6. Blockers and open items

| Item | Type | Detail |
| --- | --- | --- |
| No non-production database for Preview | Infrastructure | Preview deployments use production Supabase; sandbox needs local or a staging project |
| Test keys / Relay activation | Provider | Not issued/activated; Payonify asked for no test transactions before activation |
| Bank account + KYC | Owner | Needed before any live use |
| Payouts to drivers | Not built | Today `release_escrow_and_complete` credits the driver's ConZ wallet (same as Paynow escrow). Paying the driver out via Relay transfer needs a payout table, the 24 h hold rule and a decision on fees |
| Refunds | Manual | Done in the Payonify dashboard, then recorded in Money approvals. Refund webhooks are recorded, not acted on. Partial refunds not documented |
| Ledger label | Accountant | Paid Payonify escrow posts to the existing `paynow_clearing` account (shared function). A `payonify_clearing` account needs a small follow-up migration if the accountant wants them separate |
| Pending charge that never resolves | Provider docs | Not documented whether an unapproved EcoCash prompt becomes `failed`. Such a payment stays open (blocking new attempts for that job) until Payonify reports it or an admin checks it |
| Idempotency | Provider docs | No idempotency header documented; the code never retries a charge blindly and blocks new attempts while one is unclear |
| Webhook ordering / test-vs-live endpoints | Provider docs | Not documented; handled by re-fetching the charge and by state checks |
