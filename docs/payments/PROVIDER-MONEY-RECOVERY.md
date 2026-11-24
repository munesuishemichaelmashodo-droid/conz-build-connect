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

## Dispute after the driver has been paid out (payout `pending`, `sent`, `unknown` or `paid`)

`admin_reverse_provider_settlement` refuses ("recover it by hand"), on purpose: the money has left ConZ and
reversing the books would hide a real loss. There is no in-app function for this case yet.

1. Hold the driver's other unpaid earnings while the case is open:
   `admin_set_payable_hold(other_payable_id, true, reason)` for each.
2. Agree the outcome with the owner (and the lawyer, per the driver agreement draft, section C).
3. If ConZ refunds the customer from its own funds, or recovers money from the driver, it must be recorded
   with balanced ledger lines by a reviewed SQL statement or migration; do not edit `payments`,
   `driver_payables` or `driver_payouts` rows by hand.

**Before switching provider collection on**, build and test an admin function for this case (recovery from
a driver's future earnings plus a ConZ-funded refund, both posted to the ledger), so it is not handled by
hand-written SQL.
