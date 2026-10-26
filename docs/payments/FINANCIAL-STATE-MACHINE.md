# ConZ financial state machine

Describes what the live code does on 25/10/2026 (see `CURRENT-STATE-AUDIT.md`) and marks the rules still
waiting for a founder decision. Any change to these states needs a migration, a pgTAP test, and an update here.

## 1. Paynow payment (`payments`, type `topup`)

| From | Event (who causes it) | To | Ledger / wallet effect |
| --- | --- | --- | --- |
| — | Driver starts a top-up (`initiatePaynowTopup`, server checks amount, limits, cap) | `initiated` | none |
| `initiated` | Paynow refuses the start (server) | `failed` | none |
| `initiated` | No poll URL after 1 h (cron `expire_unsent_paynow_payments`) | `failed` (expired) | none |
| `initiated` | Hash-verified Paid / Awaiting Delivery / Delivered, matching reference and amount (callback, poll or reconcile) | `paid` | wallet +amount; `wallet_transactions` topup; ledger `paynow_clearing` → `user_wallets` |
| `initiated` | Hash-verified Cancelled / Failed | `cancelled` / `failed` | none |
| `initiated` | Hash-verified Refunded / Disputed | `failed` | none |
| `initiated` | Created / Sent / unknown status | `initiated` | none (recheck later) |
| any | Reference or amount mismatch | unchanged | none; admins alerted |
| `paid` | Any success again | `paid` | none (duplicate ignored) |
| `failed` / `cancelled` | Success reported later | unchanged | none; admins alerted to credit or refund by hand |
| `paid` | Cancelled / Failed reported | unchanged | none; admins alerted |
| `paid` | Refunded / Disputed reported | unchanged | none; admins alerted to decide on a clawback |

Never: a browser return, a client value or an admin edit moves a payment to `paid`.
Every message writes one `payment_events` row (before, after, outcome).

**Gap:** no "reconciliation required" state; anomalies are notifications plus `payment_events`
outcomes (`rejected_*`, `late_success_flagged`, `reversal_flagged`). Proposed in `IMPLEMENTATION-PLAN.md` step 4.

## 2. Manual top-up (`wallet_topup_requests`)

| From | Event | To | Effect |
| --- | --- | --- | --- |
| — | Driver submits method + reference (`request_topup`; unique reference, ≤ 5 pending, cap) | `pending` | none |
| `pending` | Driver cancels (`cancel_topup`) | `cancelled` | none |
| `pending` | Super admin with fresh step-up, not own account, after checking the money arrived (`admin_approve_topup`) | `approved` | wallet +amount; ledger `manual_topups_clearing` → `user_wallets`; audit + admin log |
| `pending` | Admin rejects with reason (`admin_reject_topup`) | `rejected` | none |
| `approved` | Approve again | `approved` | none (idempotent) |

## 3. Driver wallet (`wallets`)

`available = balance − held − withdrawal_reserved`. Cap: `balance` ≤ $150 (`max_wallet_balance`).
Users cannot update their wallet rows; only the functions above, settlement, and audited admin
adjustments (`admin_apply_wallet_change`, super admin + step-up, second approver above $100) change them.

## 4. Commission on a job (`jobs.held_commission`, `jobs.commission`)

| Job event | Commission effect |
| --- | --- |
| Driver's offer accepted (`hold_job_commission`) | First job unused: hold 0. Otherwise `available` must cover 7% of the price, then `held` += 7%. |
| Job cancelled while open or accepted (`cancel_job`) | Hold released in full. No fee. |
| Job in progress, customer or driver wants out | Not cancellable by them; dispute; admin may cancel (hold released). |
| Delivery confirmed with photo + code (`settle_direct_pay_job`) | Hold released; free first job → commission 0, flag set; otherwise `balance` −= 7% of price, ledger `user_wallets` → `platform_revenue`. |
| Completion retried | No second charge (`complete_job` returns "already"; settlement locks the job row and requires accepted/in progress). |
| Dispute resolved by admin (`resolve_dispute`) | Hold released; outcome actions (refund, waive commission, strike) are admin decisions, each audited. |

## 5. Rules waiting for founder decisions

1. **Commission base:** whole job price (current) vs transport only vs price minus a declared material cost.
2. **Charge amount:** recompute at completion (current) vs charge exactly what was held at acceptance (proposed, P-6).
3. **Driver cancellation after acceptance:** free (current) vs a small fee vs strikes only.
4. **In-progress timeout:** none (current) vs admin review after N days.
5. **Unused credit:** refundable on request (current wording) vs non-refundable vs refundable on account closure only.
6. **Rounding:** `round(x, 2)` half away from zero (current) — confirm.

## 6. Reconciliation

- Nightly `run_financial_reconciliation` compares wallets with the ledger; result shown to super admins.
- Every 10 min `request_paynow_reconcile` should poll stuck Paynow payments — **not configured** (P-1).
- Weekly by hand (until automated): Paynow portal transactions vs `payments` with status `paid` and their amounts;
  manual top-ups approved vs money received on the ConZ mobile-money/bank statement.
