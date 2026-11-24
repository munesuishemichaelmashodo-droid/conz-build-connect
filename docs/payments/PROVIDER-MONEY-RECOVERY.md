# Provider-paid jobs: disputes, refunds and payout problems (0171)

Applies only once provider collection is switched on (`payment_provider` set, `payouts_enabled = true`).
Today both are off and no provider is approved, so none of these cases can occur yet. Every admin step
below is super admin only, needs a fresh step-up (`require_aal2`), a written reason, and writes
`admin_audit_log`.

## Dispute before the driver is paid out (payable is `payable` or `held`)

1. Stop the money: `admin_set_payable_hold(payable_id, true, reason)`. The payable cannot be prepared
   for payout while held.
2. If the customer is owed the fare back: `admin_reverse_provider_settlement(job_id, reason)`. The payable
   becomes `reversed`, the job payment becomes `refund_due`, ConZ's commission on that job is reversed in
   the ledger, and the whole fare is shown as a refund owed. Running it twice changes nothing.
3. Refund the customer in the provider's dashboard, then record it:
   `admin_mark_provider_refunded(payment_id, provider_refund_reference, reason)`.
4. If the dispute goes the driver's way instead: `admin_set_payable_hold(payable_id, false, reason)`.
5. Check: `select * from public.financial_reconciliation();` — all rows `ok`.

## Payout timed out or the provider answer is unclear (`sent` / `unknown`)

Never send again. Ask the provider for the status of the existing payout reference
(`resolvePayoutByStatusCheck` in `src/lib/payments/provider.server.ts`) and record the answer with
`payout_record_result`. Only a confirmed `failed` result allows `payout_retry` (new idempotency key, at most
5 attempts; old references are kept in `previous_references`). An `unknown` payout stays parked until the
provider confirms paid or failed.

## Dispute after the driver has been paid out (migration 0173)

`admin_reverse_provider_settlement` still refuses once a payout has started: the money has left ConZ.

- Payout `pending`, `sent` or `unknown`: first get a confirmed result from the provider (section above). Nothing
  can be reversed or refunded on an unclear payout.
- Payout confirmed `paid`:
  1. `admin_open_post_payout_refund(job_id, reason)`. The customer's whole payment becomes a refund owed; ConZ's
     commission on the job is reversed; what the driver received is recorded as owed back to ConZ
     (`driver_recoveries`, ledger account `driver_recoverable`). The driver is notified and cannot delete their
     account while it is open. Running it twice changes nothing.
  2. Refund the customer in the provider's dashboard, then `admin_mark_provider_refunded(payment_id, ref, reason)`.
  3. While waiting for the driver, hold their other unpaid earnings: `admin_set_payable_hold(payable_id, true, reason)`.
  4. Close it with `admin_close_driver_recovery(recovery_id, outcome, reference, reason)`:
     `'repaid'` once the driver's repayment reaches ConZ's provider account (provider reference required), or
     `'written_off'` to record it as ConZ's loss (ledger account `platform_losses`).
  5. Check: `select * from public.financial_reconciliation();` — all rows `ok`.

Whole amounts only. Taking the money from the driver's next earnings automatically is not built: hold those
earnings (step 3), settle with the driver, then close the recovery as repaid. Agree the outcome with the owner
(and the lawyer, per the driver agreement draft, section C).
