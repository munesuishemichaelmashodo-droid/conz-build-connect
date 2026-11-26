# ConZ launch readiness: marketplace experience, financial flow, trust (26/11/2026)

**Status: IMPLEMENTATION COMPLETE — TESTING PENDING** (for this branch's changes).
- Production stays **DEPLOYED — BANK SETTLEMENT UNVERIFIED** (PR #148, 0178–0180).
- Branch: `launch/marketplace-readiness`, from `main` at `be79406`.
- This branch has no migrations; nothing was applied to production.

Evidence classes used below:
- **Prod-read**: read-only query against production on 26/11.
- **pgTAP**: local database built from the 13/08 baseline plus every migration.
- **Unit**: vitest.
- **Mock**: headless Chromium (Pixel 5) against `scripts/dev/mock-supabase.mjs`. It has no database rules.
- **Code**: read from source.

No real phone, Android app, Paynow payment or bank statement was used.

## 0. Phase zero: actual state

| Item | Finding | Evidence |
| --- | --- | --- |
| PR #149 | Merged as `be79406` after every check passed; `main` = production migrations | GitHub |
| 0180 | Live and recorded `20261126120000`. Recorded text md5 `2d8be659…` equals the git file without comments. Not reapplied | Prod-read |
| Live production deploy | Vercel READY on `7077770` (#148). #149 changed no app code | Vercel |
| Data | 3 profiles (3 verified drivers), 2 jobs (both cancelled, no driver), 1 payment (`initiated`, $4, 24/11), 0 wallet transactions, 0 reports, 0 disputes | Prod-read |
| Switches | `commission_rate` 7, `escrow_enabled` false, `withdrawals_enabled` false, `transport_pricing_enabled` false, promo credit on ($20), `maxJobBudget` **500**, `maxWalletBalance` **150** | Prod-read |
| Commission base | `hold_job_commission`, `settle_direct_pay_job` and `driver_can_accept_for` use `coalesce(final_price, budget)`: the total accepted price. Matches the owner's rule (7% of the total deal) | Prod-read |
| **$500 job ceiling still live** | 0129 and 0172 are not applied, so jobs over $500 cannot be posted. CLAUDE.md's "no $500 ceiling" applies only once 0172 is applied | Prod-read |
| Not live (in git) | 0129, 0130–0132, 0137 (parked), 0141, 0171/0173 (provider path, OFF by design), 0172, 0174 | Prod-read + status doc |
| Escrow UI | Still in code (`Con Z Pay`), reachable only when `escrow_enabled` is true. Booking forces `direct` when off | Code |

## 1. Defect and wording register (prioritised)

**Fixed on this branch:**

| # | Sev | Area | Defect | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| D1 | High | Agreement | "Change the agreement" opened a **blank** form. A driver changing one detail would silently clear the deposit, who to pay, the account and the instructions | The form starts from the version in force (`startEditing`) | Mock: deposit $50 and account prefilled |
| D2 | High | Fraud | A new agreement version that changes who to pay or how looked like any other proposal | Customer sees a "Payment details changed" warning listing what changed (`paymentDetailChanges`) | Unit 7; Mock (screenshot 11) |
| D3 | High | Help | Help page described Con Z Pay escrow, the retired free first job, wallet withdrawals, "cash or EcoCash once delivery is complete", automatic re-checks and refunds by Con Z | Payments section rewritten for direct pay, deposits, statements, disputes, the 7% rule ($400 → $28) and commission credit | Unit (wording rules); Mock |
| D4 | Med | Booking | "Cash or EcoCash to the driver when your load arrives" contradicted agreements, deposits and other methods | Says the customer pays the chosen driver the way they agree, deposit only if asked | Code |
| D5 | Med | Driver offer | The offer form could still promise "first completed job has no Con Z fee" if a profile flag was false. 0176 charges every job | Branch removed; the fee is always shown | tsc; Unit |
| D6 | Med | Payment panel | Customer guidance lacked "check the recipient", "record it here" and "a record is not proof", and gave no next step if the driver never confirms | Guidance added (the mandate's wording); an "awaiting the driver" note with a payment report link | Mock (screenshot 10) |
| D7 | Low | Wording | Driver-visible "wallet": page title, nav tab, top-up dialog, toasts, tours, offer form, receipt note, reach hint, Paynow description | Changed to "commission credit"; nav tab "Credit". Admin screens unchanged (internal) | Unit; Mock |
| D8 | Low | Dev tool | Mock backend lacked `propose_job_agreement_terms` | Stand-in added (keeps the driver's payment details on a customer version) | Mock |

**Open (owner decision or later PR):**

| # | Sev | Area | Gap | Proposed action |
| --- | --- | --- | --- | --- |
| O1 | **High** | Terms/Privacy | Terms §5–6 and Privacy mention the withdrawal PIN and "Wallet … withdrawals". The product no longer offers withdrawals | Lawyer review of the proposed wording in section 7. Not changed here (legal text) |
| O2 | **High** | Paynow | Automatic re-check of pending top-ups is not configured (`PAYNOW_RECONCILE_SECRET` + `app_secrets` missing). A pending top-up is re-checked only when the driver opens the page | Owner sets the Vercel secret; I add the matching rows on approval |
| O3 | High | Limits | $500 job ceiling live (0172 not applied); wallet cap $150 | Owner: apply 0129 then 0172, or keep the cap knowingly |
| O4 | Done | Privacy | 0170 (driver public profiles verified-only) | **Applied 26/11** (owner go) and recorded `20261124100000` |
| O5 | Med | Referrals | "Refer & Earn" promises "You earn" and a bonus. Referral rewards are live in the database (M5 still open in the audit) | Owner decides: keep (and say what is earned, in commission credit) or hide |
| O6 | Med | Admin | Payment statements are visible to admins only inside a dispute; `payment_anomaly` and `urgent_report` arrive as notifications with no queue | Later PR: an admin list of jobs with mismatched or unconfirmed payments |
| O7 | Med | Escrow code | Con Z Pay screens remain in code behind the OFF switch | Leave until the switch is retired; never turn on without a new review |
| O8 | Low | Emergency | 995/999 shown on the report screen | Owner or lawyer confirms the numbers |
| O9 | Low | Agreement | The `job_agreement` notification text does not say when payment details changed (the card does) | Later migration (notification body) |

## 2. Driver journey

| Step | Behaviour | Evidence | Gap |
| --- | --- | --- | --- |
| Verification, truck, 90-day re-check | Enforced in the database | pgTAP | Real-device upload untested |
| Job discovery and privacy before selection | Area and 2-decimal coordinates; no contacts | 0133/0153 live; pgTAP | — |
| Offer form | Shows 7% of the full price, the example "price − fee = before fuel and costs, not guaranteed profit", and reserve / charge / return | Code; Unit | Fixed D5/D7 |
| Acceptance with low credit | Refused (`driver_can_accept_for`), with a top-up toast | pgTAP 240/440 | Fixed D7 wording |
| Agreement and payment details | Driver sets deposit, timing, reason, recipient and instructions; a customer cannot redirect | pgTAP 1130 #4–5 | Fixed D1 |
| Payment statements | Driver confirms receipt per stage; write-once; repeat harmless | pgTAP 1130/1140 | — |
| Pickup, delivery, photos, PIN | Required for completion; GPS check flags only | 0096/0110/0112 live | — |
| Commission charge | Once, at verified completion | pgTAP 240/1100 | — |
| Commission credit page | No withdraw; rules; Paynow refs; receipts | Mock (26/11) | Pending top-ups: O2 |

## 3. Customer journey

| Step | Behaviour | Evidence | Gap |
| --- | --- | --- | --- |
| Post job | Quote from `compute_material_offer`; ≤ $500 | Prod-read; pgTAP | O3 |
| Compare offers | Bidder cards (no contacts) | 0152/0153 | — |
| Select driver | `accept_bid` reserves commission | pgTAP | — |
| Agreement | Confirm or suggest a change; deposit and recipient are the driver's | pgTAP 1130 | Warning D2 |
| Who, how much, when, which stage | Shown per stage with recipient and method | Mock | — |
| Record payment, driver confirms, customer agrees | Implemented; mismatch alerts admins | pgTAP; Mock | — |
| Driver never confirms | Note with chat + report link | Mock | Fixed D6 |
| Delivery PIN, receipt, rating, repeat, dispute | Existing | Earlier releases | — |

## 4. Admin and operations

| Capability | State | Gap |
| --- | --- | --- |
| Driver verification queue | Exists (24 h target, nothing automatic) | — |
| Disputes with evidence, agreement and payment statements | Exists (`DisputeEvidence`, `DisputePayments`) | Real data untested |
| Urgent safety reports | Category + badge + notification to all admins (prod-verified, rolled back) | No acknowledgement or assignment |
| Payment anomalies | Notification only | O6 |
| Commission ledger reconciliation | `admin.ledger` + `financial_reconciliation()` | — |
| Paynow reconciliation | Manual re-check from the driver's page; cron present but unconfigured | O2 |
| Step-up for money and role actions | `require_aal2`; authenticator requirement OFF | Owners set up authenticators, then switch on |
| Audit log | Exists | — |

## 5. Security and financial invariants

| Check | Result | Evidence |
| --- | --- | --- |
| Null-safe party checks (0180) | Stranger refused on a job with no driver; customer reads | pgTAP 1130 #9a/b; prod probe (rolled back) |
| Signed-out caller | Refused on plan and statements | pgTAP 1140 #5–6 |
| Admin writing a party's statement | Refused | pgTAP 1140 #7–8 |
| Unselected driver | Refused (write and read) | pgTAP 1130 #7–8, 1140 #9 |
| Job with no driver / cancelled job | No statements | pgTAP 1140 #1–4 |
| Changed agreement after a deposit | Recorded deposit keeps its recipient; plan unchanged until the customer accepts; balance follows the new accepted version | pgTAP 1140 #10–13 |
| Repeat / duplicate statement | Harmless and recorded once; one row per stage | pgTAP 1130 #15–16, 1140 #14–16 |
| **Concurrent statements** | Two sessions at the same instant with $300 and $250: one saved, one refused "already recorded"; 1 row, 1 event | Local two-session race (26/11) |
| Commission untouched by statements | Yes | pgTAP 1130 #25 |
| Reserve once / block / charge once / release once / no negative / ledger | Pass | pgTAP 240, 440, 820, 870, 1100; 25/11 concurrency races |
| Paynow hash, idempotency, duplicate and late callbacks | Pass | Unit + pgTAP (see MVP-FINALISATION) |
| Recipient details exposure | Agreement rows: parties + admins only | pgTAP 1130 #7 |

## 6. Test matrix (actual results, 26/11)

| Suite | Result |
| --- | --- |
| pgTAP, full, fresh local DB | **107 files, 2,207 checks, 0 failures** (incl. new 1140: 16/16) |
| vitest | 1,013 passed, 9 skipped (incl. new `agreement-payment-change`: 7) |
| `tsc --noEmit` | clean |
| `npm run lint:security` | exit 0 |
| eslint on changed components | clean (help.tsx keeps 2 older format errors) |
| `npm run build` (+ compiled-server smoke) | passed |
| Mock walkthrough (Pixel 5) | Help has no escrow or free-first-job text; nav "Credit"; customer guidance; claim → "waiting for driver" note; driver change keeps deposit + account; customer sees warning; 0 page errors |
| Not run | Real phone or Android app; production end-to-end job; real Paynow; screen reader |

Scenario coverage beyond these suites (from earlier releases' pgTAP): new, unverified and verified driver; insufficient credit; top-up credited once; duplicate callback; reservation; cancellation release; verified completion charge; cancellation and dispute.

## 7. Owner, legal, banking and Paynow actions

1. **Lawyer**, Terms and Privacy. Proposed wording, not applied:
   - §5: drop "and withdrawal PIN".
   - §6, second paragraph: "Commission credit is prepaid credit used only to pay Con Z's commission. It is not the Driver's earnings, cannot be withdrawn or transferred, and top-ups are made through Paynow."
   - Privacy: describe withdrawal data as historical records only.
   - Also confirm the stored-value question (`CONZ-COMMISSION-CREDIT-RISK-NOTE.md`) and the 995/999 numbers.
2. **Paynow**:
   - merchant status, settlement account, fees and settlement days in writing;
   - BuySafe off for top-ups;
   - set `PAYNOW_RECONCILE_SECRET` (Production), then approve me adding the `app_secrets` rows;
   - one authorised $1 top-up matched on the Navysky bank statement.
3. **Limits**: decide on the $500 ceiling (apply 0129 → 0172) and the $150 credit cap.
4. **0170**: applied 26/11 (done).
5. **Referrals**: keep (with honest wording) or hide.
6. **Admin authenticators**: both owners set them up, then switch on the requirement.

## 8. Phased plan

| Phase | Work | Needs |
| --- | --- | --- |
| A (this PR) | D1–D8 | Owner review + merge (no migration) |
| B | 0170 applied 26/11; configure the Paynow re-check | Secret |
| C | Terms/Privacy update after the lawyer | Lawyer |
| D | Admin payment-anomaly list (O6); agreement-change notification text (O9) | Small PR + one migration |
| E | Controlled launch: real-device run of `docs/implementation/CONZ_PLATFORM_TEST_PLAN.md` A1–A12; one real job end to end with test accounts | Owner, phones |

**Launch metrics** (all derivable from existing tables):
- jobs posted;
- share receiving an offer, and median time to first offer;
- offer → acceptance rate;
- completion, cancellation and dispute rates;
- repeat-booking rate;
- commission charged;
- drivers verified;
- payment-statement completion (stages with claim, confirm and acknowledge).

## 9. Readiness summary

| | Items |
| --- | --- |
| Completed | D1–D8 on this branch; 0178–0180 live |
| Tested | Sections 5–6 |
| Production-verified | 0178–0180 objects and probes (rolled back); settings and commission base read-only |
| Not verified | Real devices; a real production job end to end; Paynow settlement |
| Blocked | Bank settlement (needs a real top-up + statement); automatic Paynow re-check (needs the secret) |
| Owner action required | Section 7 |
