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

### Test site (sandbox)

- Site: the Vercel preview for `payments/payonify-relay`. Database: Supabase `conz-staging`
  (`fpckydgssuefzzxivvig`), never production. Google sign-in is not set up there: use email and password.
- Vercel Preview variables scoped to that branch: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all staging), `PAYONIFY_MODE=test`,
  `PAYONIFY_PUBLISHABLE_KEY` (`pk_test_`), `PAYONIFY_SECRET_KEY` (`sk_test_`), `PAYONIFY_WEBHOOK_SECRET`,
  `PAYONIFY_TESTER_USER_IDS`. A change only takes effect after a new preview build.
- Test EcoCash numbers for paying: `0771111111` succeeds (~8 s), `0771111113` fails. `0772…` numbers are for payouts
  only: a charge to `0772111111` fails. Verified 27/10: $10 Con Z Pay on the test site went to `paid` with `0771111111`.
- Admin → Approvals → "Payments provider" shows whether Payonify is on here and names any empty setting.
- Staging test accounts (passwords are not kept in git): `test-customer@example.com`,
  `test-driver@example.com`, `qa-admin@example.com` (super admin, staging only).

### Cards after the switch (off by default; owner decision 28/10/2026)

The point of moving to Payonify is that ConZ stops holding customer money: Payonify holds it and pays the driver's
EcoCash directly. Payonify Relay is **EcoCash only** (docs.payonify.com/relay; other wallets "will follow"; no cards
or bank payouts). Card money through Paynow would land in ConZ's own Paynow account and drivers' ConZ wallets, which
is the holding-money problem again. So **after the switch Paynow takes no new payments** (EcoCash only), unless
`PAYNOW_CARDS_AFTER_SWITCH=on` is set on the deployment. With it on, customers see "EcoCash" first and
"Card (Visa / Mastercard)" (Paynow) second, and card payments work as today (driver's share to the ConZ wallet).
Turn it on only as a deliberate business decision. Preferred route to cards: Payonify adding them to Relay.
Before the switch nothing changes (Paynow first, EcoCash for listed testers).

### Automatic driver payouts (0121, owner decision 27/10: "Auto-pay to EcoCash")

- When a **Payonify-paid** Con Z Pay job is released (customer's PIN), the driver's share (price minus 7%)
  is credited to the wallet as before and immediately moved into a `driver_payouts` row: wallet transaction
  + balanced ledger entry (`withdrawal_paid`). Paynow-paid Con Z Pay is unchanged (stays in the wallet).
- The server sends it with Payonify Relay (`POST /v1/transfers`, EcoCash only) to the driver's payout number
  (Wallet → Con Z Pay earnings; changing it needs the withdrawal PIN when one is set). The driver gets exactly
  their share; ConZ's commission is not sent (`application_fee_amount` 0) and stays in the Payonify balance.
  Check in sandbox what `application_fee_amount` does before using it.
- Every attempt for one payout reuses its `Idempotency-Key`. Outcomes: `succeeded`; `insufficient_funds`
  (customer's money still settling) and Relay set-up errors wait and retry; a refused recipient returns the
  money to the wallet (`returned`); timeouts stay `sending` and retry with the same key. A super admin can
  "Send again" a returned payout (step-up + reason).
- Sent immediately after the PIN is confirmed, then every 5 minutes by pg_cron → `/api/internal/payonify-payouts`.
  Needs `PAYONIFY_PAYOUTS_SECRET` (32+ chars) in Vercel and the same value + URL in `app_secrets`
  (`payonify_payouts_secret`, `payonify_payouts_url`). Results also arrive by the `transfer.*` webhook.
- Test numbers for payouts: `0772111111` succeeds; `0772111113`–`0772111116` fail (see the Relay table).
- Verified 27/10 on the test site: $10 Con Z Pay paid with `0771111111` → driver confirmed the PIN → $9.30
  payout created and sent at once → Payonify answered `insufficient_funds` (charge still settling) → queued
  to retry in 60 minutes. Nothing was debited twice; the wallet and ledger stayed balanced.

## 2b. How Relay money moves (official docs, read 28/10/2026)

Sources: docs.payonify.com/relay (modified 10/09/2026), /api/transfers, /errors, /webhooks, /llms.txt.
Class: **Documented** unless marked; nothing here is confirmed for ConZ's account by Payonify yet.

| Topic | What the docs say | Class |
| --- | --- | --- |
| Balance pools | Money is held per provider and per currency (EcoCash USD, EcoCash ZWG). EcoCash money pays out on EcoCash. | Documented |
| States | `pending` = still in "a short hold" after collection; `available` = can be transferred or refunded; `reserved` = held for transfers in flight, returned to available if one fails. | Documented |
| Hold length | Not stated anywhere ("short hold", "maturation hold"). | **Unknown** |
| Test-mode maturation | Not stated whether test money ever becomes available, or how to add test balance. | **Unknown** |
| `insufficient_funds` | "The transfer or refund amount exceeds the available funds currently held for the merchant." Pending money does not count. | Documented |
| Transfer `amount` | What the recipient gets; must be at least Payonify's processing fee. Who pays the transfer fee (ConZ, driver, split) is a project setting; `net_amount` shows what arrives. | Documented |
| `application_fee_amount` | ConZ's commission, credited to the Payonify account when the transfer succeeds. Whether it is drawn from available funds on top of `amount` is not spelled out; ConZ sends 0 and keeps its 7% as the part of the charge it does not transfer. | Documented / unclear |
| Refunds on Relay | Paid from available funds too. | Documented |
| Reversals | Only a succeeded, settled transfer; full amount, once; commission comes back too. | Documented |
| Eligibility | Relay only for approved businesses (not sole traders); can only be ticked when the project is created; live payouts need a relay payout merchant with B2C enabled (`channel_partner_not_found`, `b2c_not_allowed`). | Documented |
| Cards | Visa/Mastercard only through Checkout Sessions; "a relay project can only collect on the rails it can pay out from", so a Relay project cannot take cards. | Documented |
| Webhooks | `transfer.succeeded` / `transfer.failed`; 10 attempts with backoff up to ~17 min; signature header `Payonify-Signature: t=…,v1=…`. | Documented |
| Test numbers | Charges 771111111 ok, 771111113 fail, 771111114 never completes; transfers 772111111/2 ok, 772111113/4/6 fail. | Documented |

What this means for the stuck $9.30 test payout (staging, 28/10): Payonify answers `insufficient_funds` because the
test money is still `pending`. The code waits and retries hourly, which is correct. It can only go through once
Payonify moves test money to `available`, which their docs don't describe. No webhook has reached the test site
(0 rows in `payonify_webhook_events`); the endpoint answers (400 without a signature), so the test project's webhook
URL is probably not set to `https://conz-build-connect-git-payments-payonify-relay-con-z.vercel.app/api/payonify/webhook`.

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
- [ ] Payouts to drivers through Relay: built (0121); one test transfer must succeed first (see §2b).

## 6. Blockers and open items

| Item | Type | Detail |
| --- | --- | --- |
| Bank account + KYC + Relay + live keys | Owner / Payonify | Needed before any live use |
| Non-production database | Done | Staging project `conz-staging` used for all sandbox runs |
| Payouts to drivers | Built (0121), not yet proven | Waiting for test money to become available (see 2b); hold length unknown |
| Refunds | Manual | In the Payonify dashboard, then recorded in Money approvals |
| Ledger label | Accountant | Payonify money posts to the existing `paynow_clearing` account; a separate account is a small follow-up |
| Pending charge that never resolves | Provider docs | Undocumented whether an ignored EcoCash prompt becomes `failed`. Such a payment blocks a new attempt for that job/top-up until Payonify reports it or an admin uses "Check with Payonify" |
| Idempotency, webhook ordering | Provider docs | Not documented; the code never retries a charge blindly, re-fetches the charge, and checks state |
| Fees | Owner | Who pays Payonify's fee is a Payonify dashboard setting; no ConZ fee or commission change was made |
