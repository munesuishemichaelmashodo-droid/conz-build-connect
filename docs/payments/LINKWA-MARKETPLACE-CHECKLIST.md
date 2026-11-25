# Linkwa marketplace: implementation checklist (started 25/11/2026)

**Model (owner decision, final):** customer → Linkwa → marketplace settlement.
- Linkwa settles the driver's 93% to the driver's approved receiving account.
- Linkwa settles ConZ's 7% to ConZ's business account.
- ConZ never receives and redistributes the driver's money.
- ConZ keeps the records, commission accounting, reconciliation, support and disputes.
- Example: $340 deal → driver $316.20, ConZ $23.80. Provider fees are separate and shown, never folded into the commission.

Working branch: `feat/linkwa-sandbox-collection` (PR #146, draft). Production stays read-only; nothing is switched on there without the owner's cutover approval.

Legend: ✅ done and tested · 🟡 partly done · ⛔ blocked (see section B) · ⬜ not started · 👤 owner approval needed

## A. Checklist

### Phase 1 — recover existing work
- ✅ State recovered 25/11:
  - `main` = PR #147 (direct-pay launch) pending merge;
  - PR #146 = Linkwa collection, sandbox-only;
  - production has 0176 and not 0170–0175;
  - staging has everything up to 0176 (rebuilt 25/11).
- ✅ Existing evidence reused, not re-audited: `LINKWA-SANDBOX-VALIDATION-2026-11-25.md`, `LINKWA-SANDBOX-RESULTS-2026-11-25.md`, `DIRECT-PAY-LAUNCH-2026-11-25.md`.
- ✅ Linkwa's documentation for sub-merchants, split settlement and settlement status is **not in the repository** and cannot be fetched from this session (network policy). → B1.

### Phase 2 — driver registration and marketplace settlement
- 🟡 Driver Linkwa account record (0177): sub-merchant id, KYC status, masked receiving account, verification time, change history; written only by the server and admins.
- 🟡 Gate (0177): only a driver with an **approved** Linkwa account can be accepted on a Linkwa-paid job or settled.
- ⛔ Submit a driver to Linkwa (API endpoint and fields unknown → B1).
- ⛔ Receiving-account verification and change workflow at Linkwa (→ B1, B4).
- ✅ Allocation records: `driver_payables` (0171) records 93/7 once per job and per payment; tested (pgTAP 1090/1095, staging lifecycle 25/11: $23.80 / $316.20).
- ⛔ Tell Linkwa the split for each payment (rule format, per-link or per-account → B2).
- ✅ Settlement tracking: `driver_payouts` (0171) has an idempotency key, provider reference, `pending/sent/unknown/paid/failed`, "paid" only from a provider-confirmed result, and retry only after a confirmed failure.
- ⛔ Read Linkwa's settlement confirmation (endpoint or webhook → B3).

### Phase 3 — payment confirmation, accounting, reconciliation
- ✅ Payment links, signed webhooks, server-side status check, exact amount/currency/reference, idempotent apply, duplicate and late handling, return-page confirmation, admin re-check (tested; real SmileCash sandbox payment 25/11).
- ✅ Pending webhook no longer lost (0175 fix, pgTAP 1095).
- 🟡 Fee display: the customer sees the agreed price, that Linkwa adds its fees, and the total on Linkwa's page before paying. Exact percentages unconfirmed → B5.
- ⬜ Expiry of an unused payment link (needs Linkwa's link-expiry behaviour → B2).

### Phase 4 — Paynow retirement, one commission mechanism
- ✅ No double commission: a Linkwa-paid job never reserves or charges commission credit (`hold_job_commission` returns 0; settlement takes 7% from the fare once). Tested on staging.
- 🟡 Paynow inventory and retirement plan (section C). The switch-off itself is 👤 at cutover.
- ⬜ Plan for drivers' unused commission credit at cutover (section C) 👤.

### Phase 5 — staging end-to-end
- ✅ Payment initiation, success, return without webhook, wrong amount/currency, duplicates (simulated and one real sandbox payment).
- ⛔ Sub-merchant registration, KYC, receiving account, real 93/7 split, real settlement to the driver and to ConZ, payout timeout/failure, reversal → B1–B4, B6.
- ⛔ Invalid-signature and duplicate webhooks over HTTP: no webhook configured on the sandbox app (→ B6).

### Phase 6 — customer and driver journeys
- ✅ Honest receipts (no "paid directly" for Linkwa jobs; the driver's own confirmation for direct jobs).
- 🟡 Checkout pre-payment summary: material, quantity, price split, agreed total, fees note, cancellation/dispute terms.
- ⬜ Home, registration, help, terms copy for the Linkwa model: only at cutover 👤, so live copy never describes a model that is not running.

### Phase 7 — cutover
- ⬜ Cutover plan, rollback and monitoring document (after B1–B6 are answered).

## B. Consolidated questions for Linkwa (technical; capability is already confirmed)

**B1. Sub-merchant registration**
- Endpoint(s), required fields and their formats.
- KYC documents: does Linkwa collect them directly from the driver (preferred, so ConZ stores none) or through ConZ?
- KYC statuses and how ConZ is told: webhook event name and payload, or a status endpoint.
- The sub-merchant identifier field.
- How a driver's receiving account (EcoCash, SmileCash, bank) is added and verified, and how a change is verified.

**B2. Split / allocation**
- How the 93/7 rule is expressed: per payment link (a field on `POST /payment-links`?) or per sub-merchant account.
- Percentage or fixed amount, and rounding to the cent.
- Which party each Linkwa fee is deducted from.
- Can a link be single-use and bound to one sub-merchant?
- Link expiry: is there an `expires_at` field, and what status does an expired attempt report?

**B3. Settlement confirmation**
- How ConZ learns that the driver's share and ConZ's share were settled: event name and payload, or an endpoint.
- Settlement statuses (submitted, processing, completed, failed, reversed).
- The settlement reference field.
- Idempotency key support.
- What a timeout means, and how to query a settlement by reference without resending it.

**B4. Payout timing and control**
- Immediate vs scheduled settlement.
- Can ConZ hold a driver's settlement until delivery is confirmed, or until a dispute is closed? (This decides whether disputes can be resolved before money moves.)

**B5. Fees (confirm exact policy)**
- Is the buyer fee 3%, or the 1% platform + 2% online payment cost seen in the sandbox on 25/11?
- Does the 4.5% non-SmileCash settlement fee apply to the driver's settlement, to ConZ's, or both?
- Is it calculated on the gross amount or the share?
- What does the status API report as `amount` (the sandbox returned the 340.00 subtotal)?

**B6. Sandbox support**
- Can sub-merchants, KYC, splits and settlements be exercised in the sandbox? With which test identities and accounts?
- How to enable webhooks on the sandbox app (it showed "0 webhooks").
- EcoCash test numbers (EcoCash stayed on "Authorize payment"; SmileCash worked).

**B7. Refunds and reversals**
- Refund API for a split payment.
- How a refund is funded once the driver has been settled.
- Chargeback notification.

## C. Paynow inventory and retirement plan

Paynow today is used only for drivers' commission-credit top-ups:
- `paynow.server.ts`, `paynow.functions.ts`;
- the IPN route `api/public/paynow-ipn.ts`;
- `api/internal/paynow-reconcile.ts` and cron `paynow-reconcile`;
- `apply_paynow_result`, `credit_wallet_from_payment`;
- the escrow functions (escrow is off).

Customers never pay through Paynow in the live model.

**Retirement at cutover (👤):**
1. Turn off new top-ups (hide "Top up"; refuse new `request_topup` / Paynow initiation).
2. Keep the IPN and reconcile routes running until every `initiated` Paynow payment is closed, so late results still apply exactly once.
3. Keep every historical `payments`, `payment_events`, `wallet_transactions`, ledger and audit row.
4. Unused commission credit (owner decision):
   - (a) keep it spendable on remaining direct-pay jobs until a cut-off date; or
   - (b) refund it outside the app through the original channel, recorded as an admin adjustment with a reason (two-person rule, daily caps).

   It is never converted into marketplace money automatically.
5. Direct-pay jobs already accepted at cutover finish under the old rules: credit reserved at acceptance, charged once at completion.
