# ConZ — overnight readiness report (11→12/10/2026)

Local work only, branch `feature/nationwide-sourcing`. Nothing pushed, merged, deployed or committed tonight; hosted Supabase
was **not contacted**; no Paynow call, charge or payout was made. Everything marked *stand-in* ran on an embedded Postgres
replay in the cloud workspace, **not** on your real Supabase/Docker stack.

## A. GO / NO-GO

| Question | Verdict | Why |
|---|---|---|
| Controlled real **USD $1 wallet top-up** tomorrow | **CONDITIONAL GO — top-up leg only** | The Paynow initiate → hash-verified IPN/poll → `apply_paynow_result` → wallet path is covered by real-stack tests (020: 43 assertions; 190) and by a 10-parallel-IPN race check (1 credit, 9 `duplicate_ignored`). It is only GO if you confirm the 3 owner checks in F-1…F-3 (what `www.conz.co.zw` is actually running, live Paynow credentials, hosted migration level). I cannot verify any of those from here. |
| Escrow (Con Z Pay), commission release, withdrawal approval/payout on the live site | **NO-GO** | Migrations 0077–0094 are not live; the branch is not deployed; escrow has never been run against real Paynow; manual-payout tracking (0094) exists only locally. |
| **General customer use** | **NO-GO** | See H (6 materials have no verified supplier; stock-tracking hazard; no payout provider; MFA conflict; no staging run; migration rollout not performed). |

Evidence level: real-stack suite last confirmed by you = **20 files / 564 tests PASS** (before tonight's additions).
Tonight's additions (0094, tests 210/220, code changes) are verified on the stand-in only until you run the one command in F-0.

## B. Work completed tonight

**Migration `20261012000000_0094_withdrawal_payout_tracking.sql`** (new, unapplied)
- Adds `paid_at / paid_by / payout_reference / payout_note` to `wallet_withdrawal_requests`. `status` unchanged: *approved = debited, payout still owed*; **paid only when an admin records the real transfer reference**.
- `admin_mark_withdrawal_paid(id, reference, note)`: admin/super_admin (super_admin needs aal2, same as approval), never your own withdrawal, reference 3–80 chars, idempotent (first confirmation wins), audit log + wallet audit + driver notification. Moves no money and posts no ledger entry.
- `financial_request_guard`: the only change allowed on an approved withdrawal is setting the payout fields once, never from a client session.
- `admin_approve_withdrawal`: logic untouched; driver notification no longer says "withdrawn" — it says approved, payout pending, sent by hand.
- Not done (needs your decision): reversing a failed payout, and a payout-confirmation ledger entry (no cash account exists in the ledger's allowed accounts).

**App code**
- `wallet.tsx`: driver sees "Payout recorded as sent (ref …)" only when `paid_at` is set; "Approved · payout pending" otherwise.
- `admin.revenue.tsx`: "Record payout sent" button (asks for the transfer reference), awaiting-payout badge, CSV includes payout columns.
- `src/lib/withdrawalStatus.ts` (+ unit test): single place for the truthful wording.
- **`booking.functions.ts` + `src/lib/roadDistance.ts` (+ unit test): a customer price/quote is no longer issued from a straight-line (haversine) distance.** Before, if the OSRM router timed out, `computeOffer`/`computePublicOffer` silently priced from haversine (understates road distance) — only the sourcing path was OSRM-only. Now it fails closed with a retryable message. *Behaviour change: during OSRM outages customers see "try again" instead of a cheaper price.*

**Tests added**
- `210_withdrawal_payout_tracking` (22): approved ≠ paid; pending/rejected can't be marked paid; driver/non-admin/anon refused; direct updates cannot record a payout; reference validation; idempotency; one audit row; no money moves; driver notified once; approval notification wording.
- `220_every_material_source_and_price` (26): all 9 selectable materials priced (custom → explicit custom-quote path); sourcing only from verified supplier, exact, active, in-radius location with tracked stock ≥ order; capacity, radius, verification, precision, NULL stock, unverified supplier, paused all fail closed.
- `scripts/db-concurrency-check.sh` (disposable DB only; refuses hosted-looking hosts): 10 parallel IPNs, 8 parallel approvals, 8 parallel mark-paid, 8 parallel requests, approve-vs-cancel race. All pass (S5 run 4×: both outcomes seen, always consistent).
- Vitest: `withdrawalStatus` (4), `road-distance` (2).

## C. Test results (exact)

| Check | Result | Environment |
|---|---|---|
| Real Docker suite `node scripts/db-test.mjs test` | **last confirmed: 20 files, 564 tests, PASS** (190 + 200 included) | **real local Supabase** — *not re-run since 0094/210/220; expected now 22 files / 612 tests* |
| pgTAP 010–220 except 060 (full set listed in F-0) | **0 failed in every file** (010:39 020:43 030:54 040:27 050:45 070:31 080:26 090:29 100:18 110:24 120:13 130:16 140:51 150:40 160:8 170:33 180:10 190:16 200:21 210:22 220:26) | **stand-in** Postgres 18 replay incl. 0094 |
| 060 KYC | **not run** in stand-in (needs Supabase storage); passed on real stack earlier | — |
| `scripts/db-concurrency-check.sh` | 5/5 scenarios pass (+3 reruns) | stand-in |
| Red check | 210 fails without 0094 (`paid_at` missing); 200 failed 4/21 without the 0093 reject-reason check | stand-in |
| `npx tsc --noEmit` | 0 errors | current files |
| `npx vitest run` | 14 files, **131 passed** | current files |
| `npm run build` | passes (+ compiled-server smoke) | current files |
| `npm run lint:security` | 0 errors | current files |
| Static bundle scan | no `SERVICE_ROLE` / `PAYNOW_INTEGRATION_KEY` / `PAYNOW_RECONCILE_SECRET` string in `.vercel/output/static` | build output |
| e2e tests | none exist in the repo | — |

## D. Payment journey — traced in code (file/function, status)

| # | Step | Where | Status |
|---|---|---|---|
| 1 | Top-up request | `initiatePaynowTopup` (`paynow.functions.ts`): server inserts `payments` (user = caller, USD, amount from server-validated input), reference = payment UUID, amount `toFixed(2)` | verified by reading + tests 020/190 |
| 2 | Escrow request | `initiateEscrowPayment`: amount read **server-side** from the job; only `accepted/in_progress`; refuses if a payment is already paid/released/refund_due; polls earlier attempts first | verified by reading; double-initiate race ends in `refund_due duplicate_payment` (030) |
| 3 | Paynow call | `initiatePaynowTransaction`: SHA-512 signed; **response signature verified**; poll URL restricted to `paynow.co.zw` hosts | verified by Vitest (`paynow.server.test.ts`); **never run against real Paynow** |
| 4 | Result in | IPN `/api/public/paynow-ipn` (hash check → 400/401/404/502/503 mapping), poll on wallet/job page, cron reconcile `/api/internal/paynow-reconcile` (secret-gated; **inert until `PAYNOW_RECONCILE_SECRET` + `app_secrets` set**) | IPN/poll verified in code+tests; cron **not verified live** |
| 5 | Decision | `apply_paynow_result` (row lock): reference must equal the payment id, amount must equal stored amount, state machine; paid-after-closed / reversal / regression → anomaly notification, no auto-credit; every call logged in `payment_events` | verified (020: wrong amount, wrong reference, replay, late success) + 10-parallel race |
| 6 | Top-up credit | `credit_wallet_from_payment`: only from `initiated`, USD only, `is_valid_money`, wallet + `wallet_transactions` + ledger + audit + notification, in one transaction | verified (110, 190) |
| 7 | Escrow hold | `mark_escrow_payment_paid`: ledger `escrow_paid`; duplicate / job-closed payments go to `refund_due` | verified (030) |
| 8 | Release | `release_escrow_and_complete`: only a `paid` payment; **commission = flat 7%** via `commission_amount()`; driver wallet + ledger `escrow_released`; `release_job_commission`; auto-release after 72 h only with a delivery photo and no open dispute | verified (030, 170) |
| 9 | Refund | `escrow_mark_refund_due` → super-admin `admin_mark_escrow_refunded` (aal2, Paynow refund reference) — **refund itself is manual in the Paynow portal** | verified (030); manual by design |
| 10 | Withdrawal | `request_withdrawal` (PIN, lockout, one pending via unique index, available = balance − held, no reservation) → `admin_approve_withdrawal` (no self-approval, re-checks available under lock, debits once, ledger `withdrawal_paid`) → **manual payout** → `admin_mark_withdrawal_paid` (0094) | verified (040, 070, 200, 210, races) — payout itself is human; no provider integrated |
| 11 | Reconciliation | `financial_reconciliation()`; daily check alerts super admins, never auto-fixes | verified (110) — **cron/alert delivery not verified live** |

**Findings (exact, with status)**
1. *Fixed locally* — pricing could use haversine when OSRM failed (`booking.functions.ts: resolvePickupAndDistance`). Impact: under-priced transport. Verified by unit test; end-to-end OSRM path not exercised (no network here).
2. *Fixed locally (0094)* — no record that a payout was ever sent; approval notification read as "withdrawn".
3. *Open, verified* — `release_escrow_and_complete`: `first_job_free_used` makes the **driver's first job commission 0**, which sits beside the "flat 7%" rule. Existing behaviour, not changed. **Decision G-6.**
4. *Open, info* — `payments.paynow_reference` is set to **our own payment UUID at initiation**; the real Paynow reference replaces it only when paid. Reconcile against the Paynow portal using the UUID shown as "Reference".
5. *Open, medium* — `getRoute` calls the public OSRM demo server (`router.project-osrm.org`), which is not meant for production traffic and has no SLA. With finding 1 fixed, an outage now blocks quoting rather than under-pricing. **Decision G-9.**
6. *Open, low* — `initiatePaynowTopup` only rejects ≤ 0 although its message says "$1–$100,000"; the UI input has `min=1`. Harmless for tomorrow.
7. *Open, high (policy)* — MFA: hosted DB (0076 recorded) already requires **aal2 for any `super_admin`** money action; your 25/09 decision removed admin MFA. A super_admin without enrolled TOTP cannot approve top-ups/withdrawals/refunds on the live site until they enrol at `/mfa` (needs Supabase Auth MFA enabled). Plain `admin` accounts are not prompted. **Decision G-1.**
8. *Open, verified* — pending withdrawals reserve nothing (safe: approval re-checks); a driver can spend the same money on commission holds and the later approval will refuse. **Decision G-2.**
9. *Open* — forgotten withdrawal PIN: no self-service or admin reset exists. Support currently cannot unlock a driver. **Decision G-5.**
10. *Open* — no failed-payout/reversal path (a payout that fails after approval leaves the wallet debited). **Decision G-7.**
11. *Not found* — "RouteMatch": there is no such feature, file or commit in this repo or its history. The closest implemented feature is geographic dispatch (0089, tested by 150). I did not guess a meaning.

## E. Nationwide sourcing and the "No verified supplier pickup…" blocker

**Where the message comes from.** It exists only in the older app on `main` (`booking.functions.ts:78`, thrown when a material has *zero* `material_supply_locations` rows). This branch no longer throws it: such orders are recorded as sourcing requests (0087/0088) and quotes are issued by an admin.

**Root cause (verified from the seed migrations and the replayed schema).** Verified supply locations exist only for **stones, crusher_run, quarry_dust** (Pomona, Harare, radius 40 km; Davis Granite, Bulawayo, radius 25 km exact + regional entries — migrations 0050/0054/0055). **river_sand, pit_sand, gravel, top_soil, filling_soil and custom have no supplier at all.** That is missing business data, not a code bug, and I will not invent suppliers or coordinates.

**New hazard found (blocks rollout of 0080):** the seeded locations have `available_quantity_m3 = NULL` (“untracked”). Live resolution (0055) accepted NULL; **0080 requires `available_quantity_m3 >= order`**, so NULL matches nothing. After 0080 is applied, even stones/crusher run/quarry dust would stop being orderable until real stock figures are entered. Test 220 locks this fail-closed behaviour. I did not weaken it.

**Verified:** all 9 selectable materials priced correctly or routed to the custom-quote path; capacity, radius, verification, precision, stock, paused-site rules; OSRM-only for sourcing quotes (`sourcing.functions.ts`) and now for normal quotes. Existing 140/150/160/180 cover the sourcing workflow, dispatch, the booking-radius exception and nationwide visibility (all passed on the real stack earlier).
**Not verified:** a live OSRM call (no network here); production contents of `material_supply_locations`.

## F. Owner actions (most important first)

0. **Run the real suite once** (PowerShell, repo root): `node scripts/db-test.mjs test` then send me `.dbtest/last-run.txt`. Expected **22 files / 612 tests**. If a number differs, treat tonight's DB work as unverified.
1. **Confirm what `www.conz.co.zw` serves**: Vercel → Production deployment → commit. Expect `main` (`eb7e66f`+). Paynow `resulturl` is hard-coded to `https://www.conz.co.zw/api/public/paynow-ipn` (`src/lib/site.ts`); the IPN only arrives if that domain points at the deployment holding your Paynow env vars.
2. **Confirm Paynow credentials are the LIVE integration** (Paynow dashboard → Integrations → status Live, USD enabled) and that Vercel Production has `PAYNOW_INTEGRATION_ID` / `PAYNOW_INTEGRATION_KEY` (names only — do not paste values anywhere). A test-mode integration only completes payments from its registered `authemail`.
3. **Read-only check of hosted migration history** (dashboard → Database → Migrations, or `supabase migration list` against the linked project). Last known (11/10): `0076`. Tell me the list; do not apply anything. I did not re-read it tonight.
4. **Decide MFA (G-1)** — and until decided, approve tomorrow's items with a plain `admin` account, not the `super_admin` one.
5. **Supply real supplier data** for river sand, pit sand, gravel, top soil, filling soil: supplier name + verification, exact pickup coordinates, service radius, **tracked stock (m³)**. Also real stock for the existing Pomona/Davis rows (blocks 0080).
6. Decisions G-2…G-9 below.

### G. Policy decisions — recommendation and the exact answer needed
| # | Decision | Recommendation | Answer needed |
|---|---|---|---|
| G-1 | Admin MFA for money actions | Keep aal2 for `super_admin` only (as built); enrol TOTP; plain admins approve small items | “Reverse the 25/09 no-MFA decision for super_admin: yes/no” |
| G-2 | Withdrawal funds reservation | Reserve at request time (available = balance − held − pending) | yes/no |
| G-3 | Second approver above a threshold | Add for withdrawals as credits already have | the USD threshold N |
| G-4 | Live migration rollout | Follow `CONZ-NATIONWIDE-DEPLOYMENT-SEQUENCE.md`, adding 0092→0094 and the stock prerequisite (E) before 0080; backup first | explicit go for each batch |
| G-5 | Forgotten PIN | Support-assisted reset by a super_admin (aal2), audited, 24 h cooling-off before the next withdrawal | approve design |
| G-6 | First-job-free commission | Keep or remove; it contradicts a flat 7% on that job | keep / remove |
| G-7 | Failed payout | Admin re-credits the wallet via an audited adjustment; no automatic reversal | approve |
| G-8 | Test payment reversal | Leave the $1 in your own driver wallet (or withdraw it manually as the payout test); do not attempt a Paynow-side reversal | choose |
| G-9 | Road-routing provider | Self-hosted OSRM or a paid routing API instead of the public demo server | choose |

## G. Repository state
Reported in the chat summary from live `git status` (see message). Commits `9ab3c86` and `0c21479` are intact; both backup files untracked and untouched.

## H. Remaining blockers
| Severity | Blocker | Blocks |
|---|---|---|
| **Critical** | Hosted DB lacks 0077–0094; branch not deployed; rollout not executed | general launch, escrow/withdrawal tests |
| **Critical** | 0080 would make all current verified suppliers un-orderable (NULL stock) | rollout of 0080 → ordering |
| **High** | No verified supplier for 5 priced materials (+ custom) | ordering those materials (sourcing-request path only) |
| **High** | MFA policy conflict; owner cannot approve as super_admin without enrolment | withdrawal/refund tests |
| **High** | Real Paynow never exercised end-to-end (live or test); IPN domain/credentials unverified | $1 test (owner checks F-1/F-2) |
| **High** | No staging project (Free-plan limit) | safe rehearsal of the above |
| Medium | No payout provider (manual); no failed-payout path; PIN recovery absent; no fund reservation | general launch |
| Medium | Public OSRM demo server | general launch |
| Medium | Escrow lifecycle untested with a real $ amount (job minimum ≫ $1) | general launch |
| Low | Reconcile cron and daily reconciliation alerts unverified live; `paynow_reference` shows our UUID until paid; top-up min message | neither |
