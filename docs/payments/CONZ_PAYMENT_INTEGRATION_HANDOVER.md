# ConZ payment integration: handover (09/11/2026)

Scope per the implementation spec: **Paynow commission-credit top-ups only.** ConZ does not collect, hold or guarantee the customer's fare in V1. Linkwa is treated as
unapproved and future. Payonify (PR #38) is not merged and not live. Evidence classes: **V** verified 09/11, **C** carried from `CURRENT-STATE-AUDIT.md` (24-25/10), **U** unknown.

## 1. What is live (V, read-only query of `system_settings` and payments, 09/11)
| Setting / fact | Value |
| --- | --- |
| `commission_rate` | 7 |
| `escrow_enabled` | false (customer fare collection off) |
| `withdrawals_enabled` | false |
| `min_topup` | 1 (USD) |
| `transport_pricing_enabled` | false |
| `payment_provider` | no row (Payonify switch not applied; Paynow is the only path) |
| Payments table | 44 rows: 12 paid, 23 failed, 7 cancelled, 2 initiated |

## 2. Money flows
| Flow | Who pays whom | Status |
| --- | --- | --- |
| Job fare | Customer to driver directly (cash / mobile money), outside ConZ | Live |
| Commission credit top-up | Driver to ConZ via Paynow checkout | Built and live in code; last paid top-up 13/08 per the October audit (C); same 12 paid rows today (V) |
| Commission reserve / release / charge | Driver credit, server-side, atomic at acceptance; one release on cancel; exact reserved amount charged at completion (0113 live) | Live |
| Commission dispute refund | Back to the driver's commission credit (0160 live) | Live |
| Escrow / Con Z Pay | Customer to ConZ to driver | Built, **off**, out of V1 scope |
| Withdrawals | ConZ to driver | Built, **off** |

## 3. Paynow top-up path (C, code unchanged since)
Server function starts a Paynow checkout, stores a `payments` row, the callback (IPN) and a poll both go through `apply_paynow_result`, the wallet is credited once by
`credit_wallet_from_payment`. Callback endpoint answered a blank POST with 400 (configured); reconcile endpoint answered 503 (not configured) on 24/10 (C, not re-probed today).

## 4. Open issues from the audit that still matter (status today)
| ID | Issue | Status |
| --- | --- | --- |
| P-1 | Server-side re-check of stuck payments needs `PAYNOW_RECONCILE_*` env/secret | Open (C): owner/Vercel setting |
| P-2 | No successful live Paynow top-up since 13/08; no callback ever recorded | Open (C/V: paid count unchanged). Needs Paynow test run, then an owner-run $1 live test |
| P-11 | Paynow BuySafe: wallets credited on "Awaiting Delivery"; Paynow docs say escrow-style status for unverified merchants | Open: confirm merchant verification with Paynow before relying on instant credit |
| P-3 | No driver form for manual top-up | Open (code, small) |
| P-4 | `payments.paid_at` never set | Open (additive migration, financial table: owner review) |
| P-5 | Paynow rejection reason not stored | Open (additive, owner review) |
| P-6 | Commission recomputed at completion | **Closed**: 0113 settles the exact reserved amount |
| P-7 | In-progress jobs never expire | Open: needs an owner rule (reserve clocks are reserved decisions) |
| P-8 | Commission base includes material | Built switch: transport-only base exists (0158/0159), **off** by owner decision |
| P-9 | Wallet text promising manual refund while withdrawals are off | Open (copy, Stage 7) |

## 5. What this session did and did not do
Did: read-only verification of settings and payment counts; no provider settings, credentials, webhooks, or payment rows were touched; no synthetic transactions.
Did not: contact Paynow or Linkwa, run a test checkout, change any financial function, apply 0134 (promo) or 0120/0121 (Payonify).

## 6. Questions for the owner / provider (need answers before any change)
1. Is the Paynow merchant account verified (BuySafe behaviour, section 4 P-11)? Ask Paynow in writing.
2. Will you run the $1 live test after the callback and reconcile settings are confirmed (P-1, P-2)?
3. Linkwa: is there any agreement? Until you say yes it stays out of scope.
4. Approve additive fixes P-4 and P-5 (store `paid_at` and rejection reason)? They touch the payments table, so they are not applied without your go.
5. Payonify: keep PR #38 parked, or close it? It needs the paused staging project to continue testing.
