# Linkwa marketplace: sandbox test plan and evidence record (25/11/2026)

Linkwa's answer (25/11): test the intended use cases on the free sandbox and report specific failures. This file replaces
the broad question list in `LINKWA-MARKETPLACE-CHECKLIST.md` section B. Every row below is either evidence from a real
sandbox call or marked **not run**. Nothing here was inferred from ConZ's own database.

Target model (unchanged):
- The customer pays through Linkwa.
- The driver receives 93% of the agreed amount directly in their approved receiving account.
- ConZ receives 7%.
- ConZ never receives and redistributes the driver's money.
- Provider fees are accounted for separately.

## 1. What documentation ConZ actually holds

| Source | In the repository? | What ConZ code uses from it |
| --- | --- | --- |
| "Linkwa Developer API" (`developer-apps/docs.md`), received 24/11 | **No.** Only quoted in code comments (`src/lib/payments/linkwa-protocol.ts`, sections [API] 3, 4, 8) | Creating a payment link; reading a payment's status |
| "Webhooks Developer Documentation" (`webhooks/docs.md`) | **No.** Quoted as [HOOKS] 1 | `payment.completed` event; HMAC-SHA256 signature |
| `Linkwa-Third-Party-API.postman_collection.json` | **No.** Quoted as [POSTMAN] 4, 4b | Same two operations; status words PAID/PENDING/FAILED |
| Owner's brief, 09/11 (Linkwa public pages, unverified) | `CONZ_PAYMENT_INTEGRATION_HANDOVER.md` lines 65-74 | Mentions `/v1/third-party/payouts`, but has no request or response schema. Also says "no split-payment endpoint (a marketplace composes a collection plus payouts itself)" |

**Missing, needed before any test in section 3 can run:**
1. The three files above, committed under `docs/payments/linkwa/` (Postman collection with keys removed). The code
   cites them, but nobody can re-check the citations.
2. Documentation for every operation in this table. Not one has a schema ConZ holds. None of them is called and
   none will be guessed:

   | Operation | Status in what ConZ holds |
   | --- | --- |
   | Sub-merchant / driver registration | No schema |
   | KYC status | No schema |
   | Receiving-account verification | No schema |
   | Payout initiation | Only the path `/payouts`; no fields |
   | Payout status | No schema |
   | Split / allocation | Public pages say it does not exist |
   | Refund, reversal, failed-payout handling | No schema |
3. Linkwa says balance and statement endpoints must not be polled. They stay uncalled unless documented permission is
   given.

## 2. Evidence already obtained (real sandbox, 25/11; details in `LINKWA-SANDBOX-RESULTS-2026-11-25.md`)

| # | Operation | Endpoint (sandbox base `https://sandbox.linkwa.co.zw/api/v1/third-party`) | Request fields sent | Result | Proven |
| --- | --- | --- | --- | --- | --- |
| E1 | Create payment link | `POST /payment-links` | `amount`, `currency_code`, `payment_link_name`, `description`, `return_url`, `stock: 1` | 2xx; `checkout_url` returned | A single-use link for the exact agreed amount can be created |
| E2 | Customer checkout (SmileCash) | Linkwa hosted page | n/a | Paid; customer charged 350.20 = 340.00 + 1% platform + 2% online payment cost | Collection works. Buyer fees are added on top of the agreed price |
| E3 | Customer checkout (EcoCash) | Linkwa hosted page | n/a | Stayed on "Authorize payment", never completed | **Failure to report (S1 below)** |
| E4 | Payment status | `GET /payment-links/{short_url}/payments/{payment_reference}/status` | none | `status: PAID`, `amount: 340.00`, `currency_code: USD` | Status reports the subtotal, not the 350.20 charged; ConZ matches it to the agreed price |
| E5 | Webhook | ConZ `POST /api/payments/webhook/linkwa` | n/a | **None received**; sandbox app showed "0 webhooks" | Not proven (S2 below) |

ConZ-internal results from the same payment, which are **ConZ's accounting only and NOT provider settlement**:
- One `driver_payables` row: driver $316.20, ConZ $23.80.
- `driver_payouts`: 0 rows. No money has moved to any driver.

## 3. Test plan for the marketplace operations (sandbox only, in this order)

Fixtures:
- **Test driver:** the staging driver account (`fpckydgssuefzzxivvig`) and a Linkwa sandbox test identity. Linkwa
  supplies the test identity; no real person's ID is used.
- **Test ConZ receiving account:** a Linkwa sandbox account for ConZ's 7%.

Every call is made server-side from the `feat/linkwa-sandbox-collection` Preview (guarded: refuses the production project
and production deployments). Record each call in section 4 with secrets, phone numbers and names redacted.

| Step | What | Pass criteria | Blocked by |
| --- | --- | --- | --- |
| T1 | Register the test driver as a sub-merchant | Linkwa returns a sub-merchant id; ConZ stores it via `provider_record_driver_account` (0177, write-once) | Doc for registration |
| T2 | Read onboarding/KYC and receiving-account status | Linkwa reports approved + receiving account verified; `driver_provider_account_ready` becomes true | Doc for KYC/status |
| T3 | Customer collection for the test driver's job ($340) | E1+E4 again; status PAID 340.00 USD | Nothing (repeat of E1-E4), plus how the link is tied to the sub-merchant |
| T4 | Driver payout of $316.20 (or Linkwa's automatic split) | Linkwa reports the driver's settlement completed with its own reference | Payout/split doc |
| T5 | ConZ's $23.80 | Linkwa reports ConZ's share settled to ConZ's account | Same |
| T6 | Verify T4/T5 from Linkwa's status answers only | `driver_payouts.status = paid` only from a provider status | Payout status doc |
| T7 | Failure: payout to an invalid/unverified test account | Linkwa reports failed; ConZ records failed; no second payout | Payout doc + failure test values |
| T8 | Timeout | ConZ records `unknown`, queries by reference, never re-sends | Idempotency/query doc |
| T9 | Duplicate request (same idempotency key) | Linkwa returns the first result; one payout only | Idempotency doc |
| T10 | Retry after a confirmed failure | Exactly one new payout | Payout doc |
| T11 | Refund before and after driver settlement | Documented refund result; ConZ reverses its records (0173) | Refund doc |
| T12 | Webhook delivery and an invalid signature | Signed event accepted once; tampered event refused (401) | Webhooks enabled on the sandbox app |

**Custody question (decides whether the model is possible).** Who holds the $340 between payment and settlement?
- If Linkwa settles 93%/7% from the collected funds itself, ConZ never controls the driver's share. This is the target
  model.
- If only "collect to ConZ's merchant account, then ConZ calls `/payouts`" exists, ConZ holds and releases the driver's
  money. That contradicts the target model and needs the owner's and the lawyer's decision before any build.

T4/T5 answer this from evidence.

## 4. Evidence record (fill in per call; never paste keys or personal data)

| Step | Date/time | Method + path | Request fields (values redacted) | HTTP status | Response fields (redacted) | Provider reference | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | | | | | | | not run |

## 5. Reproducible failures to send to Linkwa support

**S1 — EcoCash checkout never completes in the sandbox.**
> Sandbox app [ConZ sandbox app name]. Payment link created with `POST /payment-links` (amount 340.00 USD, stock 1).
> On the hosted checkout we chose EcoCash, entered the test number from your sandbox table, and confirmed. The page stayed
> on "Authorize payment" and never completed or failed. With SmileCash the same link completed and the status endpoint
> returned PAID. Which EcoCash test number and step completes or fails a sandbox payment?

**S2 — No webhook delivered.**
> Our sandbox app's dashboard shows "0 webhooks (polling restricted)". A SmileCash sandbox payment completed on 25/11
> (status PAID). No `payment.completed` request reached our endpoint. How do we enable webhooks for a sandbox app, and is
> the webhook `reference` the same value as `payment_reference` in the status response?

**S3 — Marketplace operations not in the documentation we received.**
> To test our use case (customer pays once; 93% settles to the driver's own receiving account and 7% to ours, without us
> holding the driver's share), we need the sandbox documentation or Postman requests for:
> - sub-merchant registration and its KYC/receiving-account status;
> - the split or payout request and its status;
> - failure values;
> - idempotency;
> - refunds.
>
> Our documentation and Postman collection cover only payment links, payment status and webhooks. Which requests should
> we call?

S3 is only sent if the files in section 1 (once committed) really lack these operations. Check them first.

## 6. What stays as it is

These are not rebuilt:
- Collection, webhook HMAC check, server-to-server status check, idempotent apply and the admin re-check (0175 + app).
- Accounting: 7% of the total deal, once; `driver_payables`.
- Payout records with the provider-confirmed rule: `driver_payouts` (0171).
- Driver account record and gate: 0177 (switch OFF).

When the documents arrive, the next build is a provider adapter for the documented operations, mapped onto these
records.
