# ConZ legal disclosures: drafts for Zimbabwean legal review (24/11/2026)

**Status: DRAFT. Not legal advice, not approved, not published.** Each section states only what the ConZ code does
today (function names in brackets so the lawyer can ask for proof). Items marked **[LEGAL]** need a Zimbabwean lawyer's
answer before publication. Operator: Navysky Innovations (Private) Limited, company no. 145174A02102026.

What exists live today: `/terms` (17 sections) and `/privacy` (10 sections). Missing: a driver agreement, a cancellation
policy, a refunds and disputes procedure, and a data retention and deletion notice. These drafts fill those gaps. Terms §6–7
describe the current direct-pay model correctly and must change **only** when provider-collected payment is switched on.

---

## A. Driver agreement (new)

1. **Who you are to ConZ.** You are an independent transport operator, not an employee or agent of ConZ. You choose which
   requests to offer on and set your own price within the guide shown. **[LEGAL]** independent-contractor status under the
   Labour Act; whether a written agreement per driver is needed.
2. **Before you can take jobs.** ConZ checks your identity, licence and vehicle documents (`admin_set_driver_verification`)
   and re-checks every 90 days. Only a verified driver can make offers or be given a job (`is_verified_driver`).
   Changing your truck sends you back to review (0114).
3. **Commission.** ConZ earns 7% of the agreed **transport** fare.
   - *Customer pays you directly (today):* the 7% is reserved from your prepaid commission credit when the customer
     accepts you, charged once when delivery is confirmed with the customer's code and photo, and released in full if
     the job is validly cancelled (`hold_job_commission`, `settle_direct_pay_job`, `release_job_commission`).
   - *Customer pays through ConZ (only when switched on):* the 7% is taken once from the collected fare; your commission
     credit is not used; the rest is recorded as owed to you and paid out by the approved provider (`settle_provider_job`).
4. **Commission credit** is not money held for you: it can only pay ConZ's commission, cannot be withdrawn while
   withdrawals are off, and is capped at $150. Promotional credit is not cash. **[LEGAL]** whether prepaid commission
   credit is a "retail payment instrument" or deposit under RBZ guidelines; refund rights on account closure.
5. **Delivery proof.** You must take a pickup and a delivery photo with location, and complete with the customer's
   code (`record_job_evidence`, `complete_job`). Location is shared with the customer while a job is active.
6. **Cargo and road safety.** Unchanged from Terms §9–10. **[LEGAL]** goods-in-transit insurance requirement; overload
   liability.
7. **Suspension.** For fraud, repeated no-shows or unsafe conduct, with a written reason recorded (`admin_set_user_status`).

## B. Cancellation policy (new)

- A customer or driver can cancel while a job is **open or accepted** (before loading) (`cancel_job`). Any reserved
  commission is released in full; there is no cancellation fee.
- Once the trip is **in progress**, neither side can cancel in the app: raise a problem instead (an admin can cancel).
- A driver who cancels an accepted direct-pay job before loading reopens it for other drivers (0145).
- **No-show:** if the driver has not started pickup 24 hours after acceptance (or after the booked date), the job is
  cancelled automatically and the driver gets a strike (`expire_stale_accepted_jobs`).
- **Repeated customer cancellations after a driver accepted** (90-day window, `enforce_customer_strikes`): 3 → booking
  paused 24 hours; 5 → 7 days; 7 → 30 days. Strikes can be waived by an admin.
- *When paying through ConZ (switched on later):* if the customer already paid and the job is cancelled before
  loading, the full fare is recorded as a refund owed and refunded through the provider (`tg_jobs_provider_cancelled`,
  `admin_mark_provider_refunded`). **[LEGAL]** refund timing commitments; provider fees on refunds.

## C. Refunds and disputes procedure (new)

1. Either party can report a problem on a job they are part of, with a category and at least 10 characters
   (`raise_dispute`). Evidence: photos with location, chat transcript, route trail (admin-only).
2. An admin reviews it within **48 hours**; overdue cases are escalated automatically (`escalate_overdue_disputes`).
3. Outcomes are decided and recorded by an admin with a reason (`resolve_dispute`, audit log).
   - *Direct-pay job:* ConZ never held the fare, so ConZ cannot refund it. If commission was charged on a job found
     not delivered, it is returned to the **driver's** commission credit (0160).
   - *Paid through ConZ (later):* the driver's earnings for that job can be held during review (`admin_set_payable_hold`);
     a refund to the customer is paid by the provider and recorded (`admin_mark_provider_refunded`).
4. ConZ does not describe any payment as escrow, protected or guaranteed. **[LEGAL]** Consumer Protection Act
   (Chapter 14:44) duties for an intermediary; whether ConZ must state a refund period.

## D. Data retention and deletion (new; add to the Privacy Policy)

| Data | Kept for | Mechanism |
| --- | --- | --- |
| Live driver location | 24 hours | cron `prune-driver-locations` |
| Route trail of an active job | 90 days (admins only) | cron `prune-job-route-points` |
| Notifications | read/archived 14 days; all 180 days | cron `prune-old-notifications` |
| Other person's phone number | hidden after the job closes | 0028 |
| Jobs, payments, ledger, audit records | kept (financial and legal record) | append-only tables |
| Identity and vehicle documents | until account deletion | `driver-docs` storage |

**Deleting an account** (`anonymize_deleted_account`): name, phone, email, photo, ID number and document links are
removed; financial and job records are kept without personal details. Deletion is refused while a job, payment,
commission credit balance, withdrawal, top-up, dispute or (once 0171 is live) earnings still owed is open (`account_deletion_blockers`). **[LEGAL]** Cyber and Data Protection Act (Chapter 12:07):
POTRAZ data-controller licence and a registered DPO; 24-hour breach notice; hosting outside Zimbabwe (Supabase,
eu-central-2; Vercel) needs adequate-protection grounds; whether the 90-day route trail needs explicit consent.

## E. Terms §6–7 replacement (publish ONLY when provider-collected payment is switched on)

> **6. Commission.** Con Z earns 7% of the agreed transport fare for each completed delivery. Materials and other
> charges are not included. On jobs you pay through Con Z, the 7% is taken from the fare once, at confirmed delivery;
> the driver's commission credit is not used. On jobs paid to the driver directly, it is taken once from the driver's
> prepaid commission credit.
>
> **7. Payments.** You can pay the driver directly, or, where shown, pay through Con Z's approved payment provider
> ([provider name]). Payment is confirmed only by the provider, never by a page in the app. The driver is paid out
> through [provider] after delivery is confirmed. Provider fees of [amount/who pays] apply. Con Z is not a bank and
> does not offer escrow or a payment guarantee.

**[LEGAL]** before E: the provider agreement must permit marketplace collection and payouts for Navysky; who is the
merchant of record; receipts and fiscalisation (ZIMRA); VAT on the 7% (15.5%; registration threshold); RBZ position on
collecting for third parties.

---

## Review checklist for the lawyer and accountant

- [ ] A–D approved for publication as pages (`/driver-agreement`, `/cancellation`, `/disputes`, Privacy §5 retention)
- [ ] Independent-contractor wording (A1)
- [ ] Prepaid commission credit status and refund on closure (A4)
- [ ] Consumer Protection Act refund and intermediary duties (C4)
- [ ] CDPA licence, DPO, transfers abroad, route-trail consent (D)
- [ ] Provider model: merchant of record, RBZ, receipts, VAT (E)
