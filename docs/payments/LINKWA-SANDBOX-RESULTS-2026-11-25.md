# ConZ × Linkwa: first real sandbox payment, results and what needs work (25/11/2026)

This document stands alone and can be shared as is. It contains no keys, passwords or personal contact details.

## 1. What ConZ is and what was being tested

ConZ is a Zimbabwean marketplace for construction deliveries (sand, stone, tipper trucks). Customers post a job, drivers send offers, and the customer accepts one. The agreed price is `final_price`. It covers materials and transport together.

**Rule:** ConZ earns **7% of the whole agreed price**, charged once. Example: $300 materials + $100 transport = $400 → $28.

There are two ways a customer can pay:

1. **Live today: driver-paid.** The customer pays the driver directly. ConZ takes its 7% from the driver's **prepaid commission credit**, which drivers top up through Paynow.
2. **Being tested: provider-paid.** The customer pays online through a payment provider. ConZ records the money, takes 7% once at delivery, and records the rest as **owed to the driver** (`driver_payables`). Paying drivers out is **not built and switched off**. Linkwa (a Zimbabwean payment-link provider) is the candidate provider.

**This test** ran Linkwa's **sandbox** (test mode, no real money). It ran on a separate test copy of the ConZ database ("staging") and a separate test website. Production was not touched.

## 2. What was done before the payment

- **Staging rebuilt** from the code repository: 148 database migrations, recorded in order. Its structure was checked identical to the automated test database, and all 17 money reconciliation checks pass.
- **Test website isolated.** The Linkwa branch's test site uses only the staging database. Live Paynow keys are blanked there. The staging server key is set for that branch only.
  - A key accidentally saved to Production and to all test sites was removed before any production deploy.
- **One bug fixed before testing.** If Linkwa's notification ("webhook") arrived while Linkwa still said "pending", ConZ used up that notification. Linkwa's retry was then ignored, and the paid customer stayed "unpaid". Now a pending answer is not recorded and ConZ asks Linkwa to retry. Automated tests were added: 20 database checks and 1 unit test.
- **Automated tests:** 2,201 database checks and 1,010 unit tests pass, and the app builds.

## 3. What happened in the real sandbox test (25/11/2026)

1. A test customer and a test driver signed up on the test site. The driver was approved on staging.
2. The customer posted a **$340** job with "Pay online with Linkwa (sandbox test)". The driver offered $340 and the customer accepted.
3. The customer tapped **Pay with Linkwa**. ConZ called Linkwa's real sandbox API and got a single-use payment link (`sandbox.linkwa.co.zw/.../bSXfw61`) for exactly **$340 USD**.
4. **Linkwa's checkout added fees on top:**

   | Line | Amount |
   | --- | --- |
   | Subtotal (ConZ price) | $340.00 |
   | Linkwa platform fee 1% | $3.40 |
   | Online payment cost 2% | $6.80 |
   | **Customer pays** | **$350.20** |

5. **EcoCash did not complete in the sandbox.** It stopped at "Authorize Payment, check your phone" with a countdown, and no test prompt ever arrives. **SmileCash worked:** test number 263711111111, OTP 000000.
6. Linkwa returned the customer to ConZ, which showed **"Payment confirmed — Linkwa confirmed your payment. Your driver can now load."**
   - ConZ did not trust the redirect. It asked Linkwa server to server for that payment's status.
   - Linkwa answered `PAID`, **amount 340.00**, currency **USD**, with the payment reference.
7. The driver uploaded pickup and drop-off photos. The customer confirmed delivery with the PIN.
8. Settlement:
   - ConZ commission **$23.80** (7% of $340).
   - Driver owed **$316.20**.
   - Driver's commission credit untouched ($0 before and after, no transactions).
   - No payout created.

### Database evidence (staging)

| Record | Value |
| --- | --- |
| Payment | `released`, $340.00 USD |
| Link identifiers | link id `01m88wpk…`, short URL `bSXfw61`, payment reference `eb7de90e-…`, receipt id: none (not in Linkwa's status answer) |
| Provider events | 1: `status_check`, reported `paid` / 340 / USD → `applied_paid` |
| Ledger on payment | provider_clearing +340, job_funds_unsettled −340 |
| Ledger on settlement | job_funds_unsettled +340, driver_payable −316.20, platform_revenue −23.80 |
| Driver payables | gross 340.00, commission 23.80, owed 316.20, status `payable` |
| Payouts | 0 |
| Reconciliation | all checks OK |

## 4. Questions this answered

| Question | Answer (observed in the sandbox) |
| --- | --- |
| Does Linkwa's status "amount" include its fees? | **No.** It returns the subtotal (340.00), not the 350.20 the customer paid. ConZ's exact-amount check works. |
| Which word means paid? | **`PAID`** (not "COMPLETED") |
| Currency field | `USD`, consistent |
| Is the short URL the last part of the checkout link? | **Yes** |
| Does the created link echo the amount as a number? | **Yes** (the link was accepted and recorded) |
| Is the customer's return trustworthy? | ConZ re-checked with Linkwa server to server before applying anything |

## 5. Still not tested or unknown

- **Webhooks (Linkwa notifying ConZ by itself): not tested.** None was received; probably not configured, or not on the current Linkwa plan. Still unknown: whether the webhook's `reference` matches the status `payment_reference`.
- **Failure cases on the real sandbox:** insufficient funds, cancelled, timeout, wrong OTP. So far they are only tested in simulation, where they work.
- **EcoCash** in sandbox. Live behaviour is unknown.
- **Delayed payments:** if the customer closes the browser before returning, ConZ never learns the payment reference. Without a webhook, nothing confirms the payment, so it needs webhooks or an admin "check payment" tool.

## 6. Problems found that need work

### Business and structure (owner decisions)

1. **Who holds the money, and how is the driver paid?** In this model the customer's $350.20 goes to ConZ's Linkwa merchant account, and ConZ owes the driver $316.20. ConZ has **no payout process yet** (payouts are off by design). Before any live use, decide:
   - how and when drivers are paid: manual bank/EcoCash transfer, or Linkwa payouts;
   - who handles refunds and disputes;
   - what the law requires. This changes ConZ from "never holds the fare" to holding customer money until the driver is paid. That needs legal and RBZ advice. Never describe it as escrow, protected or guaranteed.
2. **Customer pays about 3% more than the ConZ price** (Linkwa 1% + online payment 2%). Decide: show it before checkout, absorb it, or build it into pricing. Today ConZ shows $340 and Linkwa then asks for $350.20, which will confuse customers.
3. **EcoCash is Zimbabwe's main wallet.** Confirm with Linkwa that EcoCash works live and how to test it in the sandbox.
4. **A real-looking email** arrived at the test customer's real inbox during the test. It said "ZB Notifications / ZBWalletPlus — Payment Request, 350.20 USD" with blank reference, status and description, and a "Make Payment" button.
   - It appears to come from the sandbox checkout. Do not click it.
   - Ask Linkwa whether its sandbox sends real notifications, because a test mode should not.

### Product and app fixes (code)

5. **Wrong receipt text for online-paid jobs.** The delivery-complete screen says "Paid to you directly by the customer. The Con Z fee comes off your wallet balance." For a Linkwa-paid job, the customer paid ConZ and the driver is *owed* $316.20, so the text must follow the payment method.
6. **Out-of-date wallet text.** "Your first completed job has no commission". The first-job-free offer was retired on 09/11/2026.
7. **Delivery proof accepted a screenshot** (the drop-off "photo" was a PNG screenshot of the payment page). Decide whether proof photos must be taken with the camera at the time.
8. **No recovery if the customer never returns:** add webhooks or an admin "re-check payment" action.
9. **Driver earnings view:** "Owed to you $316.20 / Paid out $0" is correct. There is no way yet to mark it paid; this follows from decision 1.

## 7. Where things stand

- **Engineering verdict: SANDBOX READY for collection.** A real sandbox payment worked end to end:
  - the correct amount, recorded once;
  - 7% of the full deal, taken once;
  - driver earnings kept separate from the commission credit;
  - reconciliation clean.
- **Not ready for production.** First: payouts, fee disclosure, EcoCash confirmation, webhooks or recovery, the receipt-text fixes, and legal/regulatory sign-off on holding customer funds.
- Production is unchanged. Linkwa collection is off there, along with payouts, escrow and withdrawals.

## 8. Suggested next steps, in order

1. Owner decisions: payout method and timing, fee disclosure, legal check on holding customer funds.
2. Ask Linkwa:
   - whether EcoCash works in the sandbox, and how to test it;
   - which plan has webhooks, and their exact payload;
   - why the sandbox sent a ZB WalletPlus payment request email;
   - how settlement to ConZ's account works, and its timing.
3. Code:
   - fix the receipt and wallet text (items 5 and 6);
   - add an admin "re-check Linkwa payment" action;
   - show Linkwa's fees before checkout;
   - decide on camera-only proof photos.
4. Re-test on the sandbox: the failure numbers, then a webhook delivery, then a cancellation after payment (refund owed).
