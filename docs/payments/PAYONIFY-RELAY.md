# Payonify Relay — sandbox client and what live use would need

Status 26/10/2026: **sandbox client only** (`src/lib/payonify.server.ts`, 14 unit tests). It is not
called by any route, job, wallet or commission code. No database change, no live keys, no real money.

## What the public docs say (docs.payonify.com, read 26/10/2026)

| Topic | Documented |
| --- | --- |
| Auth | HTTP Basic, `base64(pk_…:sk_…)`; test keys `pk_test_`/`sk_test_`, live `pk_live_`/`sk_live_` |
| Base URL | `https://api.payonify.com/v1` (test vs live chosen by key) |
| Amounts | Integers in the smallest unit (100 = $1.00), `usd` or `zwg`; charges ≥ 100 |
| Collect | `POST /v1/charges` (EcoCash/OneMoney inline, cards via Checkout Sessions); statuses `requires_payment_method`, `requires_authorization`, `pending`, `succeeded`, `failed`, `cancelled`; `metadata` ≤ 5 keys |
| Relay balance | `GET /v1/transfers/balance`: `available`, `pending` (maturation hold), `reserved` |
| Pay a driver | `POST /v1/transfers`: `amount`, `currency`, `application_fee_amount` (our commission), `description`, `destination.mobile_money.ecocash.mobile_number`. **EcoCash only.** Returns 201 `pending` |
| Outcome | Webhook `transfer.succeeded` / `transfer.failed`, or `GET /v1/transfers/{id}` |
| Fees | `net_amount` = what the driver receives after the transfer fee; who pays the fee is a project setting (us, recipient, split) |
| Reversal | `POST /v1/reversals {transfer, reason}` → `processing` → `reversal.succeeded/failed`. Full amount, once, only after `succeeded`; our commission is reversed too. Money returns to our balance — **it does not refund the customer** (that is `POST /v1/refunds` on the charge) |
| Webhooks | `Payonify-Signature: t=…,v1=…`, HMAC-SHA256 of `t.rawBody`, 5-minute tolerance, up to 10 attempts, may repeat — dedupe by event `id` |
| Test numbers | `772111111`/`772111112` succeed; `772111113` can't receive; `772111114` times out; `772111116` unregistered |
| Access | Relay must be ticked when the project is created; approved businesses only (not sole traders); live URL reviewed; Payout API listed under Enterprise |

**Not documented (ask Payonify, don't assume):** idempotency for `POST /v1/transfers` and charges; the
exact hold before charge funds become `available` (support said 24 h); whether transfers accept `metadata`;
the minimum transfer amount vs. fee; settlement of `application_fee_amount` to the bank ($25 minimum per
support); ZWG relay support; webhook secret rotation.

## What the client does
- Refuses non-test keys, so a live key in the environment can't move money by accident.
- Builds exactly the documented requests; converts dollars to cents exactly; normalises EcoCash numbers.
- Verifies webhook signatures (timing-safe, 5-minute window) and rejects live-mode events.
- Never logs keys or request bodies.

## Why it isn't wired in yet (needs founder decisions)
1. **Model change.** The current proposal (`ARCHITECTURE-DECISION.md`) keeps ConZ from ever holding
   customer money: customers pay drivers directly, and drivers pre-fund the 7% commission. Relay means ConZ
   collects the full job price and pays drivers out. That is "holding customer funds", which the earlier
   research flagged for a lawyer and accountant (RBZ / stored-value questions) before going live.
2. **Duplicate payouts.** Payonify documents no idempotency for transfers, so a timeout followed by a retry
   could pay a driver twice. A safe integration must record one payout intent per job in the database (unique
   on job), send the transfer once, and on an unclear result look it up with `GET /v1/transfers` before
   anything else.
3. **Schema.** Live use needs a reviewed migration: `payout_intents` (job, amount, commission, provider id,
   status, unique per job), `provider_events` (event id unique, for webhook dedupe), and functions that move
   a job's escrow from `paid` → `released` only on a verified `transfer.succeeded`. It must keep the existing
   state machine (`FINANCIAL-STATE-MACHINE.md`), the 24 h hold, and admin investigation.
4. **EcoCash only.** Drivers on OneMoney or bank accounts can't be paid through Relay today.

## Suggested next step (when approved)
Create a Payonify test project with Relay ticked, put the test keys in Vercel (Preview environment only), and
run the four documented flows against the test numbers: charge succeeds, transfer succeeds, transfer fails
(`772111113`), transfer times out (`772111114`) — checking `pending` is never treated as paid out.
