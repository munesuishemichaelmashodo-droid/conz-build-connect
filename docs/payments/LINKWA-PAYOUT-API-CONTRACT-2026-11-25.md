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


## Update 25/11 18:30: Developer API page (owner's screenshots of `linkwa.co.zw/developer-apps/docs`)

The owner sent screenshots of the Developer API page. Linkwa's own words are quoted. **This section supersedes the classifications in sections 1–2.**

### Authentication and keys
- Every request needs `Authorization: Bearer <key>`, `Content-Type: application/json` and `Accept: application/json`.
- There are two key types:

  | Key | Plan | Base | Can do |
  | --- | --- | --- | --- |
  | Developer API Key | Developer | `https://linkwa.co.zw/api/v1/third-party` | "Full programmatic access: create payment links, manage wallets, instruct payouts, query balances and statements" |
  | Integration Key | Growth | `https://linkwa.co.zw/api/v1/integrations` | "Can only create payment links and check payment status". `return_url` must match the registered store domain |

- Errors:
  - 401 `{"message":"Invalid API Key."}`
  - 403 "Wrong key type for this endpoint"
- **Webhooks are a Growth-plan feature** (webhooks doc), while payouts need the Developer key. Which plan(s) ConZ needs for both is question Q8.

### Operations, now with documented responses

| # | Operation | Documented response |
| --- | --- | --- |
| 1 | `POST /users` {first_name, last_name, phone_number, email}. "If the user doesn't exist on Linkwa, an account will be created automatically … save [external_user_id] and use [it] for all future requests" | 200 `{message:"User linked successfully", user:{first_name, last_name, phone_number, external_user_id}}`; 422 `{message:"User validation failed", errors:{phone_number:[…]}}` |
| 2 | `POST /wallets` {external_user_id, phone_number}; optional first_name, last_name, date_of_birth, id_number, gender (MALE/…), id_picture (multipart). "We currently only support SmileCash wallets." "Linkwa will first check if the phone number is already registered on SmileCash. If it is, the wallet is linked automatically. If it is not registered, you must provide the optional registration details" | 200 `{message:"Wallet registered…", wallet:{external_wallet_id:"w_…", provider:"smilecash", phone_number}}`; 422 `{message:"Phone number is not…", requires_registration:true, required_fields:[first_name,last_name,date_of_birth,id_number,gender,id_picture]}`; 404 `{message:"User not found."}` |
| 2s | **Payouts to self (app owner wallet):** "pass your Owner External User ID (… starting with `oeuid_`) as the external_user_id. This links a wallet to yourself as the app owner to facilitate self-payouts" | (same as 2) |
| 3 | `POST /payment-links` (unchanged). "**Linkwa does not hold funds — they are settled directly to the merchant account or held temporarily for payouts.**" | 200 `{message, product:{checkout_url, amount, currency_code, qr_code, external_payment_link_id}}`; 422 `{message:"Validation failed", errors:{amount:[…]}}` |
| 4 | `GET /payment-links/{short_url}/payments/{payment_reference}/status`. "You MUST use both parameters to securely verify the payment status" | 200 `{payment_reference, currency_code, status:"PAID", short_url, amount, payment_date_time}` |
| 5 | `GET /balance`. "Card payments (Visa/Mastercard) settle within 3 to 4 working days … The amount will initially land in the pending balances until the bank settles" | 200 `{balances:[{currency, available_balance, pending_balance}]}` |
| 6 | `GET /statement?currency_code=USD&per_page=25` | 200 `{data:[{id, type:"credit", currency, description, amount, created_date, balance_after, recipient:{type:"payment_received", external_payment_link_id, payment_link_name}, payment_method, completed_date}], meta:{current_page,…}}`. Only a credit row is shown; a payout row's shape is not shown |
| 7 | `POST /payouts` {external_user_id, external_wallet_id, amount, currency_code, include_balance_after}. "Instruct Linkwa to pay out funds to a user's verified wallet. This requires the external_wallet_id obtained from the /wallets endpoint" | 200 `{message:"Payout instructed…", payout:{payout_id, amount, currency}, balance_after:{available_balance, pending_balance, currency}}`; 404 `{message:"User not found."}`; 422 `{message:"Insufficient funds…"}` |

### Sandbox test values (section 8, checkout only)
Use these as the buyer's number at checkout (EcoCash, OneMoney, InnBucks, Omari, SmileCash):

| Number | Outcome | Payment status |
| --- | --- | --- |
| **0788687707** | Success | COMPLETED |
| 0711000001 | Insufficient funds | FAILED |
| 0711000000 | Buyer cancelled | CANCELLED |
| 0712000000 | Timed out | EXPIRED |
| 0713000000 | Wallet not found | FAILED |
| 0714000000 | Limit exceeded | FAILED |
| 0715000000 | Gateway error | FAILED |

OTPs (Omari, SmileCash): 000000 = success, 111111 = incorrect (FAILED).

Cards:
- Success: 5123450000000008, 4242424242424242.
- Declined: 5123450000000010, 4000000000000002.
- System error: 5123450000000002.
- Expired: 4000000000000069.

The table's "COMPLETED" is the checkout outcome. The status endpoint returned `PAID` on 25/11 (ConZ maps only PAID as paid; unchanged).

"How to test" step 4: "Poll the payment status endpoint". Polling payment status is therefore allowed on the sandbox. `/balance` and `/statement` still have no stated polling allowance.

**Correction:**
- The 25/11 EcoCash attempt used 263711111111, which is not in this table. That is why it stayed on "Authorize payment".
- The support message S1 in the sandbox test plan is withdrawn. Re-test EcoCash with **0788687707** before reporting anything.

### Revised capability classification

| | Capability | Class |
| --- | --- | --- |
| A | Recipient registration | **Documented** (request + response + errors) |
| B | Wallet registration | **Documented**; SmileCash only |
| C | KYC | **Documented as SmileCash registration data** passed by ConZ (incl. ID number and ID picture). No approval/KYC status read is documented; the wallet response has no status field. Requires Linkwa confirmation |
| D | Payout initiation | **Documented** (request + response + 404/422) |
| E | Payout status / reconciliation | **Not documented** beyond "Payout instructed" + `payout_id`. A statement row for a payout is not shown. Requires Linkwa confirmation |
| F | Several payouts from one collection | Possible by composition: payouts draw on the app's available balance |
| G | Idempotency, retry, failure after "instructed" | **Not documented**: no idempotency key; failures only 404/422 at instruction time |
| H | Refunds / reversals | **Not documented** |
| I | Payout webhooks | **Not documented** |
| J | Automatic 93/7 | **Not available** as an endpoint. ConZ composes it: one payout of 93% to the driver's wallet; the 7% stays in the app balance or is paid to ConZ's own wallet via the `oeuid_` self-payout |

### Custody, in Linkwa's own words
"Linkwa does not hold funds — they are settled directly to the merchant account or **held temporarily for payouts**". Payouts are made "from the app's available balance" when ConZ instructs them.

So the customer's money sits in **ConZ's app balance at Linkwa** until ConZ calls `/payouts`. Linkwa is the holder; **ConZ alone controls release**. This is still ConZ controlling the driver's 93%, which needs the owner's and the lawyer's decision. Card payments also stay in **pending** for 3–4 working days, so a driver paid by card cannot be paid out until they settle. Mobile money has no such delay stated.

### Updated questions for Linkwa (replaces section 7)
1. After `Payout instructed`, how do we learn the final outcome (sent / failed / reversed): a payout status endpoint, a webhook, or the statement? What does a payout row in `/statement` look like, and how often may we read it?
2. Is there an idempotency key for `/payouts`? If a request times out, how do we find out whether `payout_id` was created?
3. After `/wallets` registration with KYC data, is the wallet usable at once, or is there an approval step? How is a rejection reported?
4. Refunds/reversals of a paid link, before and after a payout?
5. Payout fees, and which balance they come from.
6. Is an app holding funds for third-party recipients (drivers) in its available balance acceptable under Linkwa's terms? Is there a limit on how long funds may stay there?
7. Card-paid collections: is the whole amount pending for 3–4 working days, and is a payout refused (422) until then?
8. Plans: payouts need the Developer key, webhooks need Growth. Can one app have both, and does the sandbox app support webhooks?

### Sandbox tests now runnable (Developer key on the guarded Preview; staging only)

| Test | Steps | Expected |
| --- | --- | --- |
| T1 | `POST /users` for the test driver | 200 + `external_user_id` |
| T1e | `POST /users` with an invalid phone | 422 |
| T2 | `POST /wallets` with a SmileCash sandbox number | 200 + `external_wallet_id` (`w_…`) |
| T2e | `POST /wallets` with an unregistered number | 422 `requires_registration` (record `required_fields`; **do not send ID data**) |
| T2u | `POST /wallets` with an unknown `external_user_id` | 404 |
| T3 | New $340 collection paid with 0788687707 (and SmileCash OTP 000000) | Status PAID |
| T3c | Same with card 4242… | Then read `/balance` once to see whether it lands in pending |
| T4 | `POST /payouts` $316.20 to the T2 wallet | 200 `payout_id` |
| T4e | `POST /payouts` more than the available balance | 422 Insufficient funds |
| T4u | `POST /payouts` to an unknown user | 404 |
| T5 | ConZ owner wallet via `oeuid_` | Link only; no self-payout until the owner decides |
| T6 | Same payout body twice | Record whether Linkwa makes two payouts. ConZ's own unique key must block the second call before it is sent |
| T7 | One `/statement` read after T4 | Shape of a payout row, if any |
| T8 | EcoCash re-test with 0788687707 | |

## Credentials: two keys, staging only (25/11)

The Preview of `feat/linkwa-sandbox-collection` holds `LINKWA_MODE`, `LINKWA_API_KEY` and `LINKWA_WEBHOOK_SECRET`. `LINKWA_BASE_URL` is not set, so the default `https://sandbox.linkwa.co.zw/api/v1/third-party` is used.

| Variable (Preview, branch `feat/linkwa-sandbox-collection` only) | Holds | Used for | Status |
| --- | --- | --- | --- |
| `LINKWA_API_KEY` | Growth **Integration key** (`sk_sandbox_…`) | Payment links, status checks, admin re-check | Exists; **unchanged** |
| `LINKWA_WEBHOOK_SECRET` | Webhook signing secret | `X-Linkwa-Signature` check | Exists; unchanged |
| `LINKWA_MODE` | `sandbox` | Sandbox guard | Exists; unchanged |
| **`LINKWA_DEVELOPER_API_KEY`** | Developer plan **Developer API key** (`sk_sandbox_…`) | Users, wallets, payouts (and a one-off statement read) | **New; owner adds it** |

`linkwaDeveloperConfig()` in `src/lib/payments/linkwa-config.server.ts` enforces:
- the same guard as collection: staging/local database only, no production deployment, sandbox host only, `LINKWA_MODE=sandbox`;
- the key must start with `sk_sandbox_`;
- the key must differ from `LINKWA_API_KEY`.

Without it, collection keeps working exactly as before (unit test `linkwa-developer-config`).

Note: the Growth key worked against the `/third-party` sandbox base on 25/11, although the docs give integration keys the `/api/v1/integrations` base. It is left as it is because it works. If Linkwa later enforces the split, set `LINKWA_BASE_URL` (the guard will need the integrations sandbox URL added).

## Dashboard facts (owner's screenshots, linkwa.co.zw "Payments & Payouts" / Wallets, 25/11 18:41–18:53)

- **"Developer Apps (App Ledger): Money collected by developer apps is held in each app's App Ledger balance and is not stored in the fallback wallet. These funds will not be automatically transferred; you can trigger manual payouts via API or enable auto-payout for the app."** This confirms the custody finding: collected money sits in ConZ's app ledger until ConZ pays it out (or turns on auto-payout, which would send everything to ConZ's own wallet). Auto-payout must stay **off** for the marketplace model.
- Storefront, payment-link and integration money is "parked in the system Fallback Wallet" until a primary wallet is verified, then "automatically disburse[d]".
- Payout destinations in the dashboard:
  - **SmileCash:** "Instant", "0% total fees".
  - **ZIPIT (banks & mobile money):** "Instant", "4.5% total fee (0% for payouts ≤ $5.00): ZIPIT rail fee + Linkwa CSE settlement".

  The API's `/wallets` says "We currently only support SmileCash wallets", so API payouts to drivers are SmileCash only (0% payout fee) until Linkwa adds ZIPIT to the API.
- The screenshots are of the live site (`linkwa.co.zw`), not the sandbox. Balances shown: US$0.00.
