# Controlled USD $1 Paynow top-up — runbook (prepared 12/10/2026, NOT executed)

**Scope: the wallet top-up leg only.** Escrow (job minimums are far above $1), commission release and withdrawals are *not*
covered and stay NO-GO until the migrations in `CONZ-NATIONWIDE-DEPLOYMENT-SEQUENCE.md` are applied and re-tested.
**You** run this, with **your own** merchant account and payment method. Claude must not click Pay, create a payment,
forge a callback, or send any payout. Never paste the Paynow integration key, the service-role key or any token into chat,
screenshots or this file.

## 0. Before you start (all must be YES)
1. Vercel → Production deployment serving `https://www.conz.co.zw` is the hardened `main` build (commit `eb7e66f` or later) and the domain is attached to that project. *(The IPN URL is hard-coded to this domain.)*
2. Vercel Production env has `PAYNOW_INTEGRATION_ID` and `PAYNOW_INTEGRATION_KEY` (check names only). In Paynow → Integrations the same integration shows **Live** and accepts **USD**.
3. Hosted migration list read read-only (dashboard → Database → Migrations): note the last version. If it is below `0073`, **stop** — `apply_paynow_result` is missing.
4. A **test account you own** (driver role is fine). Do **not** use a `super_admin` login for this (aal2 prompts are irrelevant to top-ups but keep it simple). Note its user id.
5. No jobs are created and no withdrawal is requested during this test.

## 1. Confirm production vs sandbox without exposing credentials
Paynow dashboard → Integrations → your integration → status **Live** (not *Test mode*). In test mode only payments from the integration's registered email with Paynow's test numbers complete; a "paid" in test mode is **not** real money. Record "Live" and the date. Do not open the key.

## 2. Capture the BEFORE state (Supabase SQL editor — read-only queries; replace `<UID>`)
```sql
select balance, held, limited from wallets where user_id = '<UID>';
select id, status, amount, paynow_reference, created_at from payments where user_id = '<UID>' order by created_at desc limit 5;
select count(*) from wallet_transactions where user_id = '<UID>';
```
If `platform_ledger` exists (0074/0082 live): `select kind, account, amount from platform_ledger where user_id = '<UID>' order by created_at desc limit 6;`

## 3. Initiate
Sign in at `https://www.conz.co.zw` → **Wallet** → **Top Up** → enter **1** → **Pay with Paynow — $1.00**. You are redirected to Paynow. Pay $1 with your own EcoCash/OneMoney/ZIPIT/card. You return to `/wallet`, which polls Paynow and credits automatically.

## 4. Verify the provider's result independently
Paynow dashboard → Transactions: find the row whose **Reference equals the payment id** from step 5 (our UUID), amount **1.00**, status **Paid**. Note Paynow's own reference and any fee.

## 5. Verify the database
```sql
select id, status, amount, reported_amount, paynow_reference, paid_at, check_count from payments where user_id='<UID>' order by created_at desc limit 1;
select source, reported_status, reported_amount, outcome, status_before, status_after, created_at from payment_events where payment_id = '<PAYMENT_ID>' order by created_at;
select balance from wallets where user_id='<UID>';
select type, amount, balance_after, note from wallet_transactions where user_id='<UID>' order by created_at desc limit 2;
select action from wallet_audit_log where user_id='<UID>' order by created_at desc limit 2;
```
Expected: payment `paid`, `reported_amount` 1.00, `paynow_reference` = Paynow's reference; exactly **one** `payment_events` row with outcome `credited`; wallet = before + 1.00; one `topup` transaction +1.00; audit action `paynow_topup_credited`; (if ledger live) two balanced `paynow_topup` lines (+1.00 / −1.00). If `financial_reconciliation()` exists: `select * from financial_reconciliation();` — every check `ok`.

## 6. Duplicate-callback check (no forging)
Reload `/wallet` two or three times, wait a minute. Re-run the `payment_events` query: extra rows may appear with outcome **`duplicate_ignored`**; the balance must still be before + 1.00 and `wallet_transactions` must still show one top-up. Any second `credited` is a **stop-ship defect** — do not retry, tell Claude.

## 7. If something other than success happens
| Symptom | Meaning / action |
|---|---|
| Still `initiated` after paying | Reload `/wallet` (polls Paynow). Still nothing: Vercel logs for `[paynow-ipn]` / `[paynow-reconcile]`; `invalid hash` ⇒ wrong integration key for this integration. Do **not** pay again. |
| Cancelled at Paynow | Becomes `cancelled`/`closed_unpaid` on next poll; nothing credited. |
| Paid at Paynow but status `failed/cancelled` in ConZ | Outcome `late_success_flagged` + super-admin notification. Never credit by hand without a second person and a note; contact Claude/support with the payment id. |
| Amount mismatch notification | `rejected_amount_mismatch`: nothing credited; investigate in Paynow portal. |
| Pending > 72 h | Closed by the reconcile job *only if* `PAYNOW_RECONCILE_SECRET` and `app_secrets` are configured (not verified). |

## 8. Reverse / settle the $1 (choose one — decision G-8)
- **Recommended:** leave the $1 in your own driver wallet as test balance (Paynow fees are small and non-refundable).
- Withdraw it later *after* 0094 is live: PIN set → request → a **different** admin approves → you send $1 by hand → admin records the reference. (Not possible on the current live DB.)
- Do **not** attempt a Paynow-side reversal: the app has no wallet-top-up refund path.

## 9. Record the result
Date/time, deployment commit, Paynow reference, payment id, before/after balance, `payment_events` rows, screenshot of the Paynow transaction (hide account numbers), and "Live" integration status. Then tell Claude the outcome; a successful $1 top-up proves only the top-up leg.

## Accidental-payout / accidental-order guard
Only use **Top Up**. Don't open a job, accept a bid, press Withdraw, or approve anything. If you must test withdrawal later, use a second admin and a $1 amount you pay yourself.
