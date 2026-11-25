# Linkwa payouts: documented API contract and what it means for 93/7 (25/11/2026)

## Sources

| Source | Where | Status |
| --- | --- | --- |
| Official Postman collection "Linkwa Third-Party API" | `docs/payments/linkwa/Linkwa-Third-Party-API.postman_collection.json` | Placeholder values only; no keys |
| Official "Webhooks Developer Documentation" | `docs/payments/linkwa/webhooks-docs.md` | |
| Linkwa WooCommerce plugin | Not committed | Uses only payment links and status, under `/api/v1/integrations/...`, with `Authorization: Bearer <key>`. Nothing about payouts |
| `linkwa.co.zw/developer-apps/docs.md`, `linkwa.co.zw/faqs` | **Not read** | Host blocked from this session (DNS/network policy). The FAQ points in the owner's brief are leads only |

Nothing below comes from ConZ's own database. Every ConZ ledger row is ConZ's accounting, not provider settlement.

## 1. Documented operations

All endpoints are under `{base}/api/v1/third-party`.

The collection sets no auth on any request. ConZ's working adapter sends `Authorization: Bearer <api_key>`, which is also what Linkwa's plugin sends, and the 25/11 sandbox calls succeeded with it.

Response examples exist only for #4 and #4b. For every other request the collection gives **only the request shape**.

| # | Operation | Request | Documented response / behaviour |
| --- | --- | --- | --- |
| 1 | Link user | `POST /users` JSON `{first_name, last_name, phone_number, email}` | "obtain an `external_user_id`". No response example |
| 2 | Link wallet | `POST /wallets` JSON `{phone_number, external_user_id}` | Gives an `external_wallet_id` (collection variable "wallet_id_returned_from_link_wallet_endpoint"). "If the user is not registered on **SmileCash**, this will return **422** with a `requires_registration` flag" |
| 3 | Link wallet with registration | `POST /wallets` form-data `{phone_number, external_user_id, first_name, last_name, date_of_birth, id_number, gender, id_picture (file)}` | "Register a user on SmileCash and link their wallet". No response example; no KYC status or approval flow described |
| 4 | Create payment link | `POST /payment-links` JSON `{amount, currency_code, payment_link_name, description, return_url?, image_url?, disallowed_payment_gateways?, stock?, autofill_contact_details?, required_contact_fields?, skip_contact_step?}` | 201 `{message, product:{amount, currency_code, checkout_url, qr_code, external_payment_link_id}}`. Single-use by default |
| 4b | Payment status | `GET /payment-links/{short_url}/payments/{payment_reference}/status` | 200 `{payment_reference, currency_code, status: PAID\|PENDING\|FAILED, short_url, amount ("Net amount paid"), payment_date_time}` |
| 5 | Balance | `GET /balance` | "available and pending balance for the app, across all currencies". No example. Our sandbox dashboard says polling is restricted |
| 6 | Statement | `GET /statement?currency_code=USD&per_page=25` | "paginated ledger statement for the app. Each row includes: type, amount, balance_after, recipient details, timestamp". No example |
| 7 | Instruct payout | `POST /payouts` JSON `{external_user_id, external_wallet_id, amount, currency_code, include_balance_after?}` | "Instruct a payout **from the app's available balance** to a linked external wallet". No response example; no payout id, status, idempotency key or failure codes documented |
| W | Webhook `payment.completed` | Linkwa → ConZ, header `X-Linkwa-Signature` = hex HMAC-SHA256(raw body, secret) | Body `{event, payment_link_name, status, reference, receipt_id, amount, currency, external_payment_link_id, checkout_url, payment_date_time, customer{name,email,phone}}`. Growth plan only. Retries on 5xx/429/401/timeout, 10 attempts over ~2.5 h; 400/404 not retried. **No payout events** |

## 2. Capability classification (A–J)

| | Capability | Class |
| --- | --- | --- |
| A | Recipient registration | **Documented** (#1); response schema not shown |
| B | Wallet registration | **Documented** (#2, #3). SmileCash only, per the descriptions; verification beyond "linked" not described |
| C | KYC / approval status | Partly documented: #3 sends ID number, DOB, gender and an ID picture for SmileCash registration. **No status/approval read is documented** |
| D | Payout initiation | **Documented** (#7); response schema not shown |
| E | Payout status / reconciliation | **Not documented** (no status endpoint, no payout webhook). Only the statement (#6), which is said to be restricted for polling |
| F | Several payouts from one collection | Mentioned publicly (FAQ lead: compose individual calls). Mechanically, #7 draws on the app balance, not on a collection, so it is possible but not tied to a payment |
| G | Failure, retry, idempotency | **Not documented**. No idempotency key field in #7 |
| H | Refunds / reversals | **Not documented** |
| I | Payout webhooks | **Not documented** (webhooks doc lists only `payment.completed`) |
| J | Automatic 93/7 split | **Not documented**; FAQ lead says no split endpoint. ConZ would make one payout call (93% to the driver); the 7% stays in the app balance |

## 3. What ConZ already supports

All of this was built earlier and stays as it is:
- Payment link, status check and signature-verified webhook. This matches the official webhooks doc: hex HMAC over the raw body; pending answers 503, so Linkwa retries; a bad signature gets 401, which Linkwa also retries (harmless).
- Idempotent apply and the admin re-check.
- 7% of the total deal, charged once; `driver_payables` (93/7 per job).
- `driver_payouts`: idempotency key, `unknown` on timeout, `paid` only from a provider confirmation, retry only after a confirmed failure.
- Driver account record and gate (0177). It maps onto #1/#2 as follows: `provider_account_id` ← `external_user_id`; the receiving account ← wallet (the `external_wallet_id` still needs a column).

The webhook's `customer{name,email,phone}` is not stored by ConZ's handler. Keep it that way.

## 4. What is missing for real driver payouts

1. Response bodies for #1, #2, #3 and #7 (field names, payout identifier, status words, error codes).
2. How to confirm a payout's outcome without polling: a payout status endpoint, a payout webhook, or written permission to read `/statement` for reconciliation.
3. Idempotency for #7. Without it, a timeout cannot be retried safely, so ConZ must treat it as `unknown` and reconcile by hand.
4. Refund/reversal API.
5. Code: an adapter for #1, #2 and #7, plus a column for `external_wallet_id`. **Not written yet** (per the brief: contracts first).

## 5. Can 93/7 work with documented Linkwa capabilities? Custody

**Only with ConZ as custodian.** The customer's payment lands in **ConZ's app balance**. #7 then moves money "from the app's available balance" when ConZ calls it, so ConZ decides if and when the driver's 93% leaves.

Nothing documented settles the driver's share automatically or ring-fences it. That is exactly the "ConZ holds and redistributes driver funds" situation the model is meant to avoid. Proceeding needs an explicit owner + legal decision (RBZ stored-value / payment-facilitator questions).

Safest architecture if that decision is yes:
- Pay out automatically and promptly: one `/payouts` call for exactly the `driver_payables` amount, right after verified delivery (PIN + photo).
- One payout per job, enforced by ConZ's own unique key, since Linkwa documents none.
- A timeout is recorded `unknown` and never auto-retried until reconciled.
- Payouts only to a wallet linked for that driver, with a hold after any wallet change.
- The 7% is never paid out; it stays as ConZ's balance.
- A daily reconciliation from the statement, if Linkwa permits it.
- Disputes are raised before the payout (payout waits for completion), never clawed back after.

If the decision is no: keep the live direct-pay model (customer pays the driver; 7% from commission credit).

KYC note: #3 would make ConZ collect drivers' ID numbers and ID photos and pass them to SmileCash. This conflicts with "store no identity documents" unless it is pass-through and never stored. Prefer drivers who already have SmileCash (#2 only).

## 6. Sandbox tests (via the guarded Preview + staging; nothing in production)

Each test records the request and the **real** response, redacted.

| Test | Steps | What it establishes |
| --- | --- | --- |
| T1 | #1 link the test driver | `external_user_id` format |
| T2a | #2 with a SmileCash sandbox number | `external_wallet_id` |
| T2b | #2 with an unregistered number | expect 422 `requires_registration` |
| T3 | #4 + checkout + #4b | Repeat of 25/11 with the new driver's job; app balance should rise. Read #5 **only if Linkwa allows it** |
| T4 | #7 for $316.20 to the test wallet | Full response: id, status words |
| T5 | #7 to an invalid wallet / more than the balance | Error codes |
| T6 | #7 sent twice with identical body | Is there duplicate protection? Expect none. Our own key must stop the second call before it reaches Linkwa |
| T7 | How T4's result is confirmed (statement row? webhook?) | |
| T8 | Refund of a paid link | Expect "not supported"; record it |

## 7. Questions for Linkwa (each tied to a test above)

1. #7 response: the payout id and status words. Is a payout final when the call returns, or asynchronous? (T4)
2. How should an app confirm a payout outcome: a status endpoint, a webhook event, or `/statement` reconciliation? If the statement, what read frequency is allowed? (T7)
3. Does #7 accept an idempotency key? What happens to an identical repeated request? (T6)
4. Can the driver's share be settled directly from the collection, without passing through the app's available balance? If not, is a marketplace holding drivers' funds in its app balance acceptable under Linkwa's terms? (custody)
5. Payouts to EcoCash/bank, or SmileCash only? Payout fee and who bears it? (fees)
6. Refund or reversal of a paid link, before and after a payout. (T8)
7. Response bodies and error codes for #1, #2 and #3; how KYC approval is reported after #3. (T1–T2)
