# Payonify Relay: EcoCash payments and the Paynow → Payonify switch

Status 27/10/2026: **built and tested locally, not deployed, migration not applied.** Branch `payments/payonify-relay`
(PR #38). Owner decision 27/10: "build the switch, flip later". Paynow stays on for everyone until a super admin
moves the switch, after Payonify is approved and a $1 live test has passed.

Sources: docs.payonify.com (charges, webhooks, errors, relay, refunds; read 26/10/2026), `PAYONIFY-RELAY.md`
(client notes), `PAYONIFY-MIGRATION-PLAN.md` (wider plan), read-only checks of production's schema.

## 1. What was built

| Part | File | What it does |
| --- | --- | --- |
| Database | `supabase/migrations/20261026150000_0120_payonify_charges.sql` (undo: `supabase/rollbacks/20261026150000_0120_rollback.sql`) | `payments.provider` (default `paynow`), `provider_reference` (charge id), `provider_livemode`; one charge per payment; one open Payonify attempt per job and per user's top-ups; Payonify for Con Z Pay and top-ups only. `apply_payonify_charge()` is the only place a Payonify result changes a payment. `payonify_webhook_events` keeps events ConZ does not act on. **The payment switch** (`payment_provider` setting, `admin_set_payment_provider()`, `launch_switches().paymentProvider`). Paynow's 1-hour expiry skips Payonify rows. Top-up wallet notes say "EcoCash" or "Paynow". |
| API client | `src/lib/payonify.server.ts` | Test or live keys, which must match `PAYONIFY_MODE`. Amount read as `{value, currency}`; `livemode` read as boolean or `"true"/"false"`; 20 s timeout; refused vs unclear errors. |
| Rules + webhook | `src/lib/payonify.process.server.ts` | Who may use Payonify, the test-mode production-database refusal, starting a charge, the webhook handler. |
| Server functions | `src/lib/payonify.functions.ts` | Payment options for a user, start Con Z Pay, start a top-up, check status, admin overview, admin "Check with Payonify". |
| Webhook URL | `src/routes/api/payonify/webhook.ts` | `POST /api/payonify/webhook` (the URL saved in the Payonify project). |
| Customer screen | `jobs.$id.tsx` (Confirm & pay), `src/components/payments/PayonifyPay.tsx` | "Pay with": Paynow and/or EcoCash, as the server offers. |
| Driver screen | `wallet.tsx` (Top up wallet) | Same choice for wallet top-ups. Request list shows "Top-up · EcoCash" or "Top-up · Paynow". |
| Admin screen | Money approvals, `PayonifyAdminPanel.tsx` | Which provider takes new payments, whether this deployment has test/live keys, the switch button (super admins), Payonify payments, history, unhandled events, "Check with Payonify". |
| Paynow guards | `src/lib/paynow.functions.ts` | Paynow starts no new payment once the switch is on Payonify, or while a Payonify attempt is open for the job. |

### Who sees what

| Situation | Customers and drivers see |
| --- | --- |
| No `PAYONIFY_MODE` on the server (production today) | Paynow only, exactly as now |
| `PAYONIFY_MODE` set, switch on Paynow | Paynow; listed testers also see EcoCash |
| `PAYONIFY_MODE` set, switch on Payonify | EcoCash only; Paynow starts nothing new (open Paynow payments still finish) |
| Switch on Payonify but Payonify not set up on the server | "Online payments are paused" (fails closed) |

Labels: test mode shows "EcoCash (Payonify test)"; live mode shows "EcoCash".

### Payment flow

1. The user picks EcoCash, enters their number and taps Pay (the button is disabled while it works).
2. Server checks:
   - Con Z Pay: the switch or tester list, the Con Z Pay switch, own job, job accepted or in progress, not already paid, no other open attempt (any provider). The amount is the job price read from the database.
   - Top-ups: the same amount limits as Paynow; the database enforces the minimum and the wallet cap and its message is shown as is.
3. The server inserts the payment **before** calling Payonify, then `POST /v1/charges` with `metadata.conz_payment_id`. The charge id is stored as soon as Payonify returns it.
4. The user approves the EcoCash prompt. The screen shows "Approve the payment on your phone", checks every 6 s for 3 minutes, and has a "Check status" button.
5. Payonify sends `charge.succeeded` / `charge.failed`. The webhook verifies the signature, **re-fetches the charge from Payonify** and applies that copy:
   - Con Z Pay → `mark_escrow_payment_paid()`, the same function Paynow uses.
   - Top-up → `credit_wallet_from_payment()`.

### State mapping (Payonify charge → ConZ payment)

| Payonify status | ConZ when `initiated` | ConZ when already paid/released/refunded | ConZ when failed/cancelled |
| --- | --- | --- | --- |
| `requires_payment_method`, `requires_authorization`, `pending` | stays `initiated` | no change | no change |
| `succeeded` (amount, currency, mode, charge id and metadata all match) | `paid` (escrow held / wallet credited) | no change (`duplicate_ignored`) | no change, admins alerted (`late_success_flagged`) |
| `failed` | `failed` | no change, admins alerted (`regression_blocked`) | no change |
| `cancelled` | `cancelled` | no change, admins alerted | no change |
| anything else | no change (`unknown_status_ignored`) | no change | no change |

Any mismatch (amount, currency, test/live, charge id, metadata, wrong provider) changes nothing and alerts admins.
Every call is written to `payment_events`.

### Webhook responses

| Case | Response |
| --- | --- |
| Payonify not set up on this deployment / no webhook secret | 503 (Payonify retries later) |
| Bad or missing signature, older than 5 min, other mode (test vs live), malformed | 400, nothing recorded |
| Charge can't be fetched from Payonify | 503 (retried) |
| Database error | 500 (retried) |
| Repeat of an event already handled | 200 `duplicate_event` |
| Charge for no/unknown ConZ payment, or id/mode mismatch | 200, recorded in `payonify_webhook_events` |
| Transfer, refund, reversal, payout, checkout events | 200 `recorded_unhandled` |

## 2. Settings (Vercel; never in git, chat or logs)

| Name | Value |
| --- | --- |
| `PAYONIFY_MODE` | `test` (sandbox) or `live`. Unset = Payonify off. |
| `PAYONIFY_PUBLISHABLE_KEY` | `pk_test_…` or `pk_live_…`, matching the mode. |
| `PAYONIFY_SECRET_KEY` | `sk_test_…` or `sk_live_…`, matching the mode. Server-side only. |
| `PAYONIFY_WEBHOOK_SECRET` | `whsec_…` of the webhook endpoint for that mode. |
| `PAYONIFY_TESTER_USER_IDS` | Comma-separated ConZ user ids who see EcoCash before the switch (e.g. the owner's customer and driver test accounts). |

Rules the code enforces: keys must match the mode; **test mode refuses the production database** (fake money must
never mark real jobs paid or credit real wallets). Live mode is allowed on production.

Nothing is configured anywhere yet. No keys were created, used or stored in this work.

## 3. Switch-over day (owner steps, in order)

1. **Before:** company bank account, Payonify KYC approved, Relay activated, live keys issued.
2. Owner approves; PR #38 merged; Vercel deploys. Then migration 0120 applied to production and recorded (no DROP;
   undo script ready). Nothing changes for users: the switch starts on Paynow.
3. In Payonify (live mode): webhook endpoint `https://www.conz.co.zw/api/payonify/webhook`; copy its signing secret.
4. In Vercel → Settings → Environment Variables, **Production only**: `PAYONIFY_MODE=live`, the live keys, the
   webhook secret, and `PAYONIFY_TESTER_USER_IDS` with the owner's own account ids. Redeploy.
5. **$1 live test** (owner's accounts only): top up $1 with EcoCash as a driver; check the wallet shows +$1 and
   Money approvals shows the payment as paid. If Con Z Pay is on, pay a $1 test job and refund it in the Payonify
   dashboard.
6. Money approvals → **Move payments to Payonify** (super admin, Google re-sign-in, reason). From then on everyone
   sees EcoCash only; open Paynow payments still finish through Paynow.
7. To undo at any time: **Move back to Paynow**. Payonify payments already started still finish.

Optional before step 4: a sandbox run (test keys) on a non-production database. Vercel Preview uses the production
database, so this needs a separate Supabase project (the free plan's two projects are in use: pause venmax-admin
or upgrade) or a computer running the local stack. See §6.

## 4. Tests run (27/10/2026)

| Level | Result |
| --- | --- |
| Unit (`npm test`) | 40 files / 410 tests pass (`payonify.process.test.ts`: live mode, switch, starting a charge, webhooks) |
| Database (pgTAP, fresh local Supabase, all migrations to 0120) | 48 files / 1,210 pass, including the Paynow suites; `520_payonify_charges` has 68 (escrow, top-ups, the switch: permissions, step-up, reason, audit, fallback) |
| Webhook code against the real database functions (Payonify mocked, fake keys) | `payonify-webhook-db.test.ts` 6/6 (now with a top-up); Paynow `paynow-ipn-db.test.ts` 9/9 |
| Typecheck, security lint, build + server smoke test | pass |
| Browser, local sample data, 360 px | Tester: both options on Confirm & pay and Top up; switch on Payonify: EcoCash only, no Paynow button; default: Paynow only, as today |

**Not tested:** Payonify's real API (no keys; Relay not activated), a real EcoCash prompt, a real webhook delivery,
Android. No payment was made.

### Paynow regression

- Paynow's callback, polling and reconcile are unchanged.
- New guards: Paynow refuses to start a payment when the switch is on Payonify (the switch defaults to Paynow and
  falls back to Paynow if unreadable), and while a Payonify attempt is open for the same job.
- `expire_stale_paynow_payment` / `expire_unsent_paynow_payments`: same bodies plus "Paynow rows only". Every
  production payment is a Paynow row (read-only check: all 40 have `method = paynow`).
- `credit_wallet_from_payment`: same as 0082 except the wallet note/notification name the provider.
- The app reads no new column from the browser except `payments.method` (already readable), so it works before and after 0120.

## 5. Production readiness checklist

- [ ] Bank account, Payonify KYC, Relay activation, live keys.
- [ ] Lawyer/accountant view on ConZ holding customer funds (Con Z Pay only; top-ups are as today).
- [ ] Owner approves merging PR #38 and applying 0120.
- [ ] §3 steps 3–5: live settings, webhook, $1 live test.
- [ ] §3 step 6: the switch.
- [ ] Payouts to drivers through Relay: not built (see §6).

## 6. Blockers and open items

| Item | Type | Detail |
| --- | --- | --- |
| Bank account + KYC + Relay + live keys | Owner / Payonify | Needed before any live use |
| No non-production database for a sandbox run | Infrastructure | Optional; free plan has no room for a third project |
| Payouts to drivers | Not built | Con Z Pay release still credits the driver's ConZ wallet; withdrawals stay manual. Paying out by Relay transfer needs a payout table, the 24 h hold and a fee decision |
| Refunds | Manual | In the Payonify dashboard, then recorded in Money approvals |
| Ledger label | Accountant | Payonify money posts to the existing `paynow_clearing` account; a separate account is a small follow-up |
| Pending charge that never resolves | Provider docs | Undocumented whether an ignored EcoCash prompt becomes `failed`. Such a payment blocks a new attempt for that job/top-up until Payonify reports it or an admin uses "Check with Payonify" |
| Idempotency, webhook ordering | Provider docs | Not documented; the code never retries a charge blindly, re-fetches the charge, and checks state |
| Fees | Owner | Who pays Payonify's fee is a Payonify dashboard setting; no ConZ fee or commission change was made |
