# ConZ payments — architecture decision (PROPOSED, awaiting founder approval)

Status: proposed 25/10/2026. Nothing here is approved until both founders sign off below.
Evidence: `CURRENT-STATE-AUDIT.md`, `PROVIDER-COMPARISON.md`, `FINANCIAL-STATE-MACHINE.md`.

## Recommendation

**Primary: Option D, the hybrid MVP — keep what is built.** Customers pay drivers directly for the job.
Drivers pre-fund a capped USD commission credit through Paynow (and, as a second channel, a manual transfer
approved by a super admin). ConZ takes 7% from that credit when a delivery is confirmed. Escrow, withdrawals,
payouts and split settlement stay off.

**Fallback: same model, Pesepay as the collector** if Paynow cannot verify Navysky Innovations or will not
disable BuySafe within a reasonable time; and, in the meantime, the manual top-up channel alone.

Why: it is already implemented and tested in the database; ConZ never holds customer money; the only money
ConZ receives is its own revenue paid in advance by drivers, capped at $150 per driver and never paid out;
Paynow is the only provider found that covers EcoCash, OneMoney, InnBucks and cards in USD with a verifiable
signature, and it is already integrated. No evidence justifies replacing it.

## Who pays whom (primary)

| Money | From → to | Account that receives it | Recorded in ConZ as |
| --- | --- | --- | --- |
| Job price (materials + transport) | Customer → driver | Driver's own cash / mobile money | Job price only; no money row |
| Commission credit (Paynow) | Driver → ConZ | Navysky Innovations' bank account, via Paynow settlement | `payments` → `wallet_transactions` topup → ledger `paynow_clearing` |
| Commission credit (manual) | Driver → ConZ | ConZ's EcoCash/OneMoney merchant number or bank account (to be named) | `wallet_topup_requests` → approval → ledger `manual_topups_clearing` |
| Commission | Driver credit → ConZ revenue | Stays in ConZ's account (already received) | `wallet_transactions` commission → ledger `platform_revenue` |
| Unused credit | ConZ → driver, on request (founder decision) | Manual refund by an owner, recorded as an audited adjustment | `admin_apply_wallet_change` (negative) |

## What stays disabled
Escrow (Con Z Pay), withdrawals, automated payouts, split payments, ZiG balances — each blocked in the database
(`escrow_enabled`, `withdrawals_enabled` false; USD-only credit) and hidden in the app.

## Options compared

| | A. Direct pay, commission collected later (invoice/cash) | B. Driver-funded commission credit | C. Provider marketplace settlement | **D. Hybrid (A for job, B for commission)** |
| --- | --- | --- | --- | --- |
| Money ConZ holds | None until drivers pay invoices | Drivers' prepaid commission only | Customers' full job value | Drivers' prepaid commission only |
| Provider needed | Any merchant account | Merchant account for top-ups | Split/escrow/payout support — **none documented for Paynow; Unknown elsewhere** | Merchant account for top-ups |
| Built in ConZ | No (no invoicing) | Yes | Partly (escrow code, off) | Yes |
| Collection risk | High — drivers owe after the fact | Low — commission reserved at acceptance | Low | Low |
| Regulatory exposure | Lowest | Low–medium (prepaid credit; see questions) | Highest (holding others' money, payouts) | Low–medium |
| Fees on commission | Per invoice payment | 2.5% (mobile money) on top-ups + $8.50 per settlement | Gateway % on whole job value | Same as B |
| Ops work | Chasing debts | Approving manual top-ups; weekly reconciliation | Disputes, refunds, payouts | Same as B |
| Failure recovery | Debt write-off | Credit not spent stays as credit; anomalies flagged | Refund flows | Same as B |
| Launch now? | Possible but manual | **Yes** | No | **Yes** |

## Economics (illustrative, assumptions marked)

One $200 job; driver tops up $20 by EcoCash through Paynow. Official: Paynow EcoCash fee 2.5%
([fees](https://www.paynow.co.zw/Home/Fees)); VAT 15.5% from 01/01/2026, registration compulsory above
US$25,000 taxable supplies a year ([ZIMRA](https://www.zimra.co.zw/domestic-taxes/vat/vat-registration)).
Assumptions: ConZ absorbs the Paynow fee; IMTT on the driver's EcoCash payment is borne by the driver; whether
IMTT applies again on Paynow's settlement to ConZ is unknown.

| Line | Not VAT-registered | VAT-registered, VAT inside the 7% |
| --- | --- | --- |
| Customer pays driver (outside ConZ) | $200.00 | $200.00 |
| Commission | $14.00 | $14.00 |
| Paynow fee share (2.5% of $20 × 14/20) | −$0.35 | −$0.35 |
| Output VAT (14 × 15.5/115.5) | — | −$1.88 |
| Net to ConZ before income tax and fixed costs | **$13.65** | **$11.77** |

Fixed costs not per job: $8.50 per USD settlement (Paynow); POTRAZ data-controller licence $50–$300 a year by size;
DPO training about $1,280 once (SI 155/2024). VAT registration becomes compulsory at about 1,790 jobs of $200 a year.

## Legal and compliance position (research, not legal advice)

- **Commission credit (this model):** RBZ defines e-money as value "accepted as a means of payment by persons other
  than the issuer"; ConZ's credit is accepted only by ConZ, so it probably is not e-money. The broader "retail payment
  instrument" wording and the lack of a closed-loop exemption leave doubt: **lawyer to confirm** before scale
  ([RBZ 2017 guidelines](https://www.rbz.co.zw/documents/nps/payment-systems-guidelines-august-2017.pdf)).
  Keeping the credit capped ($150), non-transferable and non-withdrawable keeps it at the low-risk end.
- **Escrow / withdrawals / payouts:** likely regulated (money transmission under SI 80/2020, trust-account rules), and
  Paynow's own terms prohibit "payment processors [collecting] payments on behalf of merchants"
  ([Paynow terms](https://www.paynow.co.zw/Home/Terms)). Keep off.
- **Company registration and tax clearance do not authorise collecting payments**; the Paynow merchant agreement
  governs ([ZIMRA ITF263](https://www.zimra.co.zw/news/2235-tax-clearance-certificate-itf263-2)).
- **Paynow Verified status requires 3 months as an ordinary member** ([terms](https://www.paynow.co.zw/Home/Terms)),
  so a new Navysky account keeps BuySafe on and weekly settlement for at least 3 months.
- **Data protection (affects payments data too):** ConZ needs a POTRAZ data-controller licence and a registered DPO;
  breaches must be reported within 24 hours; transfers abroad (Supabase hosting) need adequate protection
  ([Cyber and Data Protection Act](https://cyrilla.org/api/files/16959887510145n7v21j7mi9.pdf),
  [SI 155/2024](https://www.veritaszim.net/sites/veritas_d/files/SI%202024-155%20Cyber%20and%20Data%20Protection%20(Licensing%20of%20Data%20Controllers%20and%20Appointment%20of%20Data%20Protection%20Officers)%20Regulations,%202024.pdf)).

### Questions for a lawyer
1. Is a capped, non-withdrawable credit spendable only on ConZ's own commission a "retail payment instrument" or a
   deposit? Is a no-objection letter from RBZ advisable?
2. If unused credit must be refunded on request, does that change the answer?
3. Is a 90-day route trail sensitive data needing written consent; is Supabase hosting abroad acceptable under s28?

### Questions for an accountant
1. VAT now (voluntary) or at the threshold; VAT-inclusive or exclusive commission; VAT at top-up or at use?
2. Does Section 90 fiscalisation apply before VAT registration; virtual fiscal device or FDMS API?
3. Does IMTT apply on Paynow's settlement to the company account?
4. How to treat unused prepaid credit (liability vs income)?

## 30-day sprint update (25/10/2026)

See the shared doc "ConZ 30-Day Revenue Sprint" and `conz-30-day-revenue-model.xlsx`. Proposed: keep this model,
add a "pay exactly what this job needs" top-up button and the manual top-up form, collect through a company-owned
account from day 1, fallback = post-paid with a one-job limit (Bolt's cash-trip model). Base-case model: about $196
collected in 30 days; $300 needs 19 completed jobs at a $350 average.

## Founder decisions required (sign each)

1. Approve Option D as the MVP model, with Pesepay as the fallback collector. ☐ / ☐
2. Commission base: **confirmed by the founders 25/10/2026: 7% of materials + transport** (the whole accepted job price, as the code does). ☑
3. Charge exactly the amount held at acceptance (recommended) or recompute at completion (current). ☐
4. Driver cancellation after acceptance: free (current) / strikes only / a small fee. ☐
5. Unused credit: refundable on request (current app text) / only on account closure / not refundable. ☐
6. Until Paynow disables BuySafe (at least 3 months for a new company account): (a) keep crediting on
   "Awaiting Delivery" — instant for drivers, accepts the dispute risk, capped at $150 per driver (current);
   (b) credit only on "Paid" — safe, but each top-up then waits for an owner to confirm "delivery" in the Paynow
   portal; (c) use the existing account if it is already Verified and can be moved to the company. ☐
9. Register with POTRAZ as a data controller and appoint a DPO (legal duty, not optional). ☐
10. Engage a lawyer and an accountant for the questions above before commission volumes grow. ☐
7. Who confirms the money for manual top-ups, and which ConZ number/account drivers send it to. ☐
8. Authorise the owner-run Paynow test-mode run and one $1 live top-up. ☐

Approved by: ____________ (founder) ____________ (founder) Date: ________
