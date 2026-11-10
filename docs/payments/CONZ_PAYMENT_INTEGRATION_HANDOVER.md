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
3. Linkwa: answered in part on 09/11/2026, see section 7. The decisions in 7.3 are still open.
4. Approve additive fixes P-4 and P-5 (store `paid_at` and rejection reason)? They touch the payments table, so they are not applied without your go.
5. Payonify: keep PR #38 parked, or close it? It needs the paused staging project to continue testing.

## 7. Linkwa (added 10/11/2026)

### 7.1 What the provider confirmed in writing
The owner supplied an email from Linkwa dated **9 November 2026**. As relayed in the owner's brief (Claude has not seen the email itself), it says:
- customer collections can be credited to the ConZ Linkwa App ledger;
- ConZ can initiate driver payouts to registered mobile wallets or bank accounts, through `/v1/third-party/payouts`;
- the documentation at `https://linkwa.co.zw/developer-apps/docs` covers payment creation, status checks and payout handling;
- Linkwa recommends sandbox testing and describes the service as self-service.

This is written confirmation that the flow is supported **in principle**. It is NOT evidence that ConZ has credentials, a configured merchant account, production access, a known request schema, known fees and settlement times, regulatory clearance, or a passed sandbox test.

### 7.2 State of the integration: nothing built, nothing tested
- Production payment mode is unchanged: the customer pays the driver directly; ConZ takes 7% from the driver's prepaid commission credit; Paynow is used only for commission-credit top-ups.
- No Linkwa code, setting, secret or migration exists in the repository. No Linkwa call has been made. The official documentation pages have not been read in this session, so no endpoint schema, signature scheme or status list is recorded here; none may be guessed.
- Public claims to verify against the account's own documents before any design is fixed (from Linkwa's public pages as quoted in the owner's brief, unverified): free sandbox; Developer plan USD 5/month for production API access; 1% platform fee + 2% online payment cost added at checkout and paid by the buyer; mobile-wallet settlement instant, card settlement about 3 to 4 working days; no split-payment endpoint (a marketplace composes a collection plus payouts itself); signed webhooks with retries.

### 7.3 Decisions only the owner can make (with a lawyer and an accountant)
1. Move from direct customer-to-driver payment to Linkwa collection and payout at all?
2. Commission: keep 7% from the collected fare and pay the driver the rest, OR pay the driver the full fare and keep charging commission credit. Never both.
3. Who pays Linkwa's checkout fee and any payout fee, and how the total is shown before payment.
4. When the customer is charged and when the driver is paid; refunds, cancellations, failed payouts, disputes after payout.
5. Which legal entity is the merchant, what receipts say, tax treatment. Deposits in or out of the flow.

### 7.4 What is needed to start a sandbox build (owner/provider)
- A Linkwa account for Navysky Innovations (Private) Limited with Dev API access; sandbox API keys stored as Vercel **Preview** variables (never in chat, code or documents).
- The account's API documentation or Postman collection: base URLs, authentication, payment creation and status, webhook signature and events, balance and statement, the payout request for wallet and bank, idempotency, limits, fees.
- `conz-staging` un-paused (the sandbox must never point at production).

### 7.5 Design the sandbox build will follow (designed, not implemented)
Server-side adapter only, behind a switch that defaults to off and refuses production (use an allow-list of the staging project, not a string match: this is finding P2-1 from the Payonify review). Payment, provider ledger, commission and payout are separate records with separate states (pending, collected, available, payout pending, paid out, failed, reversed, refunded, disputed). A callback is verified exactly as the provider documents and then re-checked server-to-server before anything changes; amount, currency, reference and mode must match; every event and payout carries a unique reference so a replay or retry changes nothing; a timeout becomes "unknown, reconcile", never a second payout; payouts have an off switch, a hold after a payout-number change and a retry cap (findings P2-2 to P2-4). Sandbox test list: success, pending, failure, timeout, duplicate callback, replay, amount mismatch, wrong currency, insufficient balance, failed payout, retry, refund, two payouts at once, reconciliation drift. The Payonify branch (PR #38) already contains most of these patterns and is the starting point, once its four findings are fixed.

### 7.6 Production gates (all required)
Owner decisions in 7.3; legal and accounting review; sandbox evidence for every case in 7.5; provider confirmation of fees, settlement and payout routes for the ConZ account; refund and reconciliation procedure; updated Terms; a $1 live test; an operator recovery plan. Until then nothing about customer payment changes in production.
