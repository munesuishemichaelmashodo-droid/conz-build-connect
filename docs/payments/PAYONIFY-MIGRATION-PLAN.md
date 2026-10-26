# Replacing Paynow with Payonify Relay — migration plan (DEFERRED)

Status 26/10/2026: **plan only.** Owner decision: finish and stabilise the current product first. Paynow stays
exactly as it is. Nothing here is built, no Payonify keys are configured, no schema is changed.

Inputs: `CURRENT-STATE-AUDIT.md` (25/10), `FINANCIAL-STATE-MACHINE.md`, `ARCHITECTURE-DECISION.md`, the draft
sandbox client in PR #27 (`docs/payments/PAYONIFY-RELAY.md` on that branch), Payonify support emails of 25–26/10
(owner's screenshots), and a read-only check of production's schema on 26/10.

## 1. Where Paynow is today (the surface to replace)

| Layer | Paynow-specific | Provider-neutral (keep) |
| --- | --- | --- |
| App screens | `wallet.tsx` (top-up), `jobs.$id.tsx` (Con Z Pay button, "Secured by Paynow", refund text), `admin.approvals.tsx` | wallet balance/holds, job states, PIN, evidence |
| Server functions | `src/lib/paynow.functions.ts` (`initiatePaynowTopup`, `initiateEscrowPayment`, `reconcilePendingPaynowPayments`), `paynow.server.ts` (hash, poll, initiate, `processPaynowIpn`), `paynow.reconcile.server.ts` | `paymentErrors.ts` |
| HTTP endpoints | `POST /api/public/paynow-ipn`, `POST /api/internal/paynow-reconcile` | — |
| Database columns | `payments.paynow_reference`, `payments.paynow_poll_url`, `payment_events.paynow_reference`, `escrow_refunds.paynow_refund_reference` | `payments.status/type/method/amount`, `wallet_withdrawal_requests.payout_reference` |
| Database functions | `apply_paynow_result`, `expire_stale_paynow_payment`, `expire_unsent_paynow_payments`, `paynow_pending_for_reconcile`, `request_paynow_reconcile`, cron `paynow-reconcile` | `credit_wallet_from_payment`, `mark_escrow_payment_paid`, `release_escrow_and_complete`, `auto_release_escrow_payments`, `escrow_mark_refund_due`, `admin_mark_escrow_refunded`, withdrawal functions, `hold_job_commission`, `settle_direct_pay_job`, ledger, `financial_reconciliation`, `launch_switches` |
| Secrets | `PAYNOW_INTEGRATION_ID/KEY`, `PAYNOW_RECONCILE_SECRET` (Vercel) | — |

**The boundary:** everything in the right-hand column already speaks in ConZ terms (payment paid, escrow released,
refund due, commission held/settled) and should not change. Only the left-hand column talks to Paynow. Migration =
put a provider adapter where the left column is, and leave the right column alone.

## 2. The bigger change is the money model, not the provider

| | Today (Paynow) | Relay |
| --- | --- | --- |
| Job price | Customer pays driver directly (cash/EcoCash) | Customer pays ConZ's Relay account |
| Commission | Driver pre-funds a wallet via Paynow; 7% held at acceptance, charged at completion | Deducted at payout (`application_fee_amount`) |
| Driver payout | None (driver already has the money) | ConZ triggers a transfer after delivery, ≥ 24 h after the customer paid |
| Escrow | Built, switched off | This *is* escrow: ConZ holds customer funds |

So Relay replaces the **escrow ("Con Z Pay") path** and, if direct pay is dropped, the commission wallet too.
Decisions needed first (see §6): keep direct pay as default? who pays fees (recommended: customer, shown as a line)?
legal/accounting sign-off on holding customer funds.

## 3. Work required (in order)

1. **Provider interface (app).** One module with `startCharge`, `getCharge`, `verifyWebhook`, `startTransfer`,
   `getTransfer`, `refund`, `reverse`, `getBalance`. Paynow implements the subset it supports (charge, poll,
   callback); Payonify implements all. Screens call ConZ functions, never a provider directly. Remove "Paynow"
   from user-facing text in the same change (use "secure payment").
2. **Schema (one reviewed migration, tested in pgTAP first).**
   - `payments.provider` (`paynow`|`payonify`), `provider_reference`, `provider_status`; keep the `paynow_*`
     columns read-only for history instead of renaming them (renames break the live callback mid-cutover).
   - `provider_events` (provider, event id **unique**, type, raw payload hash, received_at, processed_at) for
     webhook de-duplication.
   - `payout_intents` (job **unique**, driver, amount, application fee, provider transfer id, status
     `created → sent → succeeded | failed | reversed`, timestamps). One intent per job = no double payout.
   - `provider_refunds` / `provider_reversals` (or extend `escrow_refunds` with `provider` + `provider_reference`).
   - Ledger accounts: `relay_pending`, `relay_available`, `payout_clearing`, `provider_fees`.
3. **Environments and secrets.**
   - Test keys (`pk_test_`/`sk_test_`) only in Vercel **Preview**; live keys only in **Production**. The client
     refuses a key whose mode doesn't match the environment (PR #27 already refuses live keys).
   - `PAYONIFY_PUBLISHABLE_KEY`, `PAYONIFY_SECRET_KEY`, `PAYONIFY_WEBHOOK_SECRET` in Vercel only, never in git,
     the database, logs or chat. Separate webhook secret per environment; rotation procedure written down.
4. **Webhooks, idempotent.** `POST /api/payonify/webhook` (the URL already saved in the Payonify project: `https://www.conz.co.zw/api/payonify/webhook`; it returns 404 until this endpoint is built and deployed): read the raw body; verify `Payonify-Signature`
   (HMAC-SHA256 of `t.rawBody`, 5-minute tolerance, timing-safe); reject live events in Preview and test events in
   Production; insert into `provider_events` (duplicate id → return 200, do nothing); apply the state change in one
   database function inside one transaction; return 2xx only after commit. Events may repeat (up to 10 tries) and
   arrive out of order: every transition checks the current state.
5. **Pending vs available funds.** A paid charge is `pending` for 24 h (support, 26/10). Never start a transfer
   from ConZ's own clock alone: check `GET /v1/transfers/balance` (available ≥ amount) or the charge's maturity
   before sending. Show drivers "payout scheduled" rather than "paid" until `transfer.succeeded`.
6. **Transfer accounting.** On delivery confirmed (PIN or evidence) + 24 h hold passed + no open dispute:
   create the payout intent (unique per job) → `POST /v1/transfers` once → mark `sent`. Payonify documents no
   idempotency key, so on a timeout **look up** the transfer before retrying, never resend blindly.
   Ledger: customer charge → `relay_pending` → `relay_available` → driver payout + ConZ fee + provider fees.
   Fee model per the decision in §6 (customer-pays example from Payonify: $20 driver + $1.40 fee → customer
   pays $22.74). Confirm the settlement fee (support quoted 3.65% and 3.5%).
7. **Refunds and reversals (different operations).** Refund = money back to the customer from a charge
   (`POST /v1/refunds`). Reversal = pull back a driver payout (`POST /v1/reversals`), only while the money is
   still in the driver's wallet; once withdrawn it becomes a manual recovery case for an admin. The current
   `escrow_mark_refund_due` / `admin_mark_escrow_refunded` flow keeps its states; the adapter fills in provider
   references. Disputes before payout simply block the payout intent.
8. **Reconciliation.** Daily job: compare Payonify charges/transfers/refunds/balance with `payments`,
   `payout_intents` and the ledger; flag any mismatch to admins (extend `financial_reconciliation`). Settlement of
   ConZ's fees to the bank happens only from $25 upward (support).
9. **Mobile app.** The Android app is a Capacitor shell over the website, so no store release is needed for new
   server code. Check: EcoCash prompts on the phone (inline charge) work inside the WebView; any redirect/return
   URL is on `www.conz.co.zw` (the allowed origin); no external browser hand-off loses the session.
10. **Tests.** Unit (signature, amounts in cents, fee gross-up), pgTAP (state machine, unique intents, duplicate
    events, out-of-order events, refund vs reversal), sandbox runs with Payonify's test numbers (`772111111`
    success, `772111113` cannot receive, `772111114` timeout) — only after Payonify activates Relay on the project.

## 4. Cutover (when approved)

1. Ship the adapter and schema with Payonify **off** (a launch switch, like escrow today).
2. Sandbox end to end on Preview; then an owner-approved small live test.
3. Turn Payonify on for new Con Z Pay payments only; Paynow stays for wallet top-ups until drivers no longer need them.
4. Stop starting new Paynow payments; let pending ones finish or expire (`expire_stale_paynow_payment`).
5. Keep the Paynow callback endpoint and reconcile job running ≥ 30 days for late callbacks; then remove.
6. Each step reversible by the switch; nothing deletes Paynow history.

## 5. Prerequisites before any of this starts

- Product stabilisation released (owner's priority).
- Company bank account and Payonify KYC (approved business; live URL review).
- Payonify activates Relay on the project (support: "do not perform test transactions before we activate it").
- Lawyer + accountant view on ConZ holding customer funds (RBZ / stored value), as flagged in `ARCHITECTURE-DECISION.md`.

## 6. Decisions for the owner

1. Keep "pay the driver directly" as the default, with Relay as an optional protected payment? (recommended)
2. Fee option: customer pays fees (recommended), split, or ConZ absorbs (leaves ~$0.14 of a $1.40 commission).
3. Commission wallet: keep for direct pay, or retire once Relay is live?
4. Payout timing for drivers (Payonify's minimum is the 24 h hold).
5. Driver payout channel: Relay transfers are EcoCash only; what about OneMoney/bank drivers?
