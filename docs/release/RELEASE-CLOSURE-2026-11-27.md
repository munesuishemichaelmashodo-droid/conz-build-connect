# ConZ release closure (27/11/2026)

Scope: close the 14 open PRs (#152–#166, without #155 which is merged), not new features. Nothing in this document
has been merged, deployed or applied to production. "Tested" means local or CI, never production.

## 1. Release state (checked 27/11, GitHub API)

| PR | Branch | Head | Migration | CI (build + database) | Mergeable |
| --- | --- | --- | --- | --- | --- |
| #160 | terms/commission-credit-wording | 131ea48 | none | green | clean |
| #152 | stage1/rating-privacy | f99be48 | 0182 | green | clean |
| #153 | stage2/booking-journeys | f330afc | 0183 | green | clean |
| #154 | stage3/security | 128c550 | 0184 | green | clean |
| #156 | referrals/redesign | f7dd6d0 | 0181, 0185 | green | clean |
| #157 | trust/stage1-agreement | 112ed0e | 0186 | green | clean |
| #158 | trust/stage2-evidence | 3c0be61 | 0187 | green | clean |
| #159 | trust/stage3-payment-reconciliation | a4cc8f9 | 0188 | green | clean |
| #161 | finance/promo-first-job | 5a16bd3 | 0189 | green | clean |
| #162 | payments/paynow-modes | 0a7c518 | 0190 | green | clean |
| #163 | trust/driver-compliance | ca892da | 0191 | green | clean |
| #164 | trust/incident-cases | 8b69800 | 0192 | green | clean |
| #165 | trust/job-evidence-vault | eed66b8 | 0193 | green | clean |
| #166 | legal/privacy-and-compliance-docs | (this commit) | 0194 | see PR | clean |

`main` = 437d0c4 (#155). Every CI run above finished after #155 merged. Each migration 0181–0194 exists in exactly one
PR. #166 contains #160's commits, so #160 merges first.

**Merge order:** #160 → #152 → #153 → #154 → #156 → #157 → #158 → #159 → #161 → #162 → #163 → #164 → #165 → #166.

**Status 28/11:** everything above is merged and its migrations are live and recorded, except **#162 / 0190, on hold** until Paynow
replies (owner decision). #163-#166 do not depend on #162; they were released ahead of it.
Each merge to `main` deploys to production (Vercel). Known conflicts as later PRs merge (keep both sides):
- `supabase/maintenance/20261124_MIGRATION_STATUS.md` (#153, #154): keep every row.
- `scripts/dev/mock-supabase.mjs` (#157, #158): keep both blocks; the 0186 `job_agreement_in_force` stand-in must end
  with `},` before the `// 0187 stand-ins` comment (`node --check scripts/dev/mock-supabase.mjs`).
- `tests/unit/migration-hygiene.test.ts` (#153, #161, #164): keep every `ALLOWED_DROPS` entry, each with its own `],`.
- `src/routes/_authenticated/jobs.$id.tsx` (#163 after #153): keep both imports and both blocks.

## 2. Migration execution checklist (production; each step needs the owner's go)

Rules: never `supabase db push` (history 0072–0108 is still unrecorded). One migration at a time. Before: read the
"Before" hash in `supabase/maintenance/20261124_MIGRATION_STATUS.md`. After: compare function hashes with the
local build, run the read-only checks, then record the version:
`insert into supabase_migrations.schema_migrations (version, name, statements) values ('<version>', '<name>', array['<body>'])`.
Files with DROP go through the Supabase SQL editor (the MCP tool hangs on DROP).

| # | Migration | Version | Owning PR | DROP / DELETE | How | Order notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0182 rating privacy | 20261126140000 | #152 | no / no | execute_sql | after #152 is deployed |
| 2 | 0183 booking journeys | 20261126150000 | #153 | 1 (pricing_basis check, replaced in the same ALTER) / no | **SQL editor** | safe before or after #153; the transport-only choice fails to post until 0183 is applied, so apply it right after #153 deploys |
| 3 | 0184 security/trust | 20261126160000 | #154 | no / no | execute_sql | after #154 |
| 4 | 0181 referrals non-cash | 20261126130000 | #156 | no / no | execute_sql | stops cash referral rewards (cron) |
| 5 | 0185 referral dashboard | 20261126170000 | #156 | no / no | execute_sql | needs 0181 |
| 6 | 0186 agreement snapshot | 20261126180000 | #157 | no / no | execute_sql | after #157 |
| 7 | 0187 evidence workflow | 20261126190000 | #158 | no / no | execute_sql | after #158 |
| 8 | 0188 payment reconciliation | 20261126200000 | #159 | no / no | execute_sql | after #159 |
| 9 | 0189 promo first job | 20261127100000 | #161 | 1 (promo ledger kind check) / no | **SQL editor** | keeps the historical $20 grant |
| 10 | 0190 Paynow modes | 20261127110000 | #162 | no / no | execute_sql | writes no mode: production reads **off** |
| 11 | 0191 driver compliance | 20261127120000 | #163 | no / no | execute_sql | adds the daily expiry sweep |
| 12 | 0192 incident cases | 20261127130000 | #164 | 1 (reports category check) / no | **SQL editor** | after #164 |
| 13 | 0193 evidence vault | 20261127140000 | #165 | no / no | execute_sql | the Privacy line "Administrator access to evidence is logged" (#166) is true only once 0193 is live |
| 14 | 0194 account closure refund | 20261127150000 | #166 | no / no | execute_sql | after #166 |

Every migration has an undo script in `supabase/rollbacks/` (forward-safe: none restores weaker security or pays money).

## 3. Staging restoration plan (owner action; production untouched)

`conz-staging` (fpckydgssuefzzxivvig) is paused. The free plan allows two active projects: production and
`venmax-admin`. Options, none of which pause production:
1. Pause `venmax-admin` for the test window, restore `conz-staging`, test, then pause staging and restore venmax-admin; or
2. upgrade the organisation plan for the test window.
Then: rebuild staging from the CI baseline (`20260813999999_baseline…` + every later migration, as `scripts/db-test.mjs`
does), point a Vercel **Preview** deployment at it (Preview-scoped env vars only; never change Production env), seed
test accounts only, and run sections 4 and 6 there. Staging test accounts (Linkwa era) are listed in
`supabase/maintenance/20261127_staging_linkwa_test_accounts_inventory.sql`.

## 4. Payment acceptance test plan (Paynow; staging, TEST then LIVE $1 with written approval)

Nothing below uses real money without the owner's written approval. Live stays OFF until: written Paynow approval of
Commission Credit as the product, company merchant account, company bank settlement, and regulatory clarification.

| # | Case | How | Pass criteria | Covered today |
| --- | --- | --- | --- | --- |
| P1 | Successful payment | LIVE mode, $1 top-up | one `payments` row → `paid`, wallet +$1 once, ledger line, `payment_events` row | pgTAP 1240 (simulated), DB unit `paynow-ipn-db` |
| P2 | Failed / cancelled payment | cancel on Paynow page | row → failed/cancelled, wallet unchanged | 1240 |
| P3 | Delayed webhook | hold the IPN; poll/reconcile first | credited once by whichever arrives first, later one `duplicate_ignored` | 1240, race P1–P5 |
| P4 | Duplicate webhook | resend the same IPN ×10 in parallel | one credit | race S1 (10 parallel IPNs) |
| P5 | Forged / invalid notification | wrong hash, wrong amount, unknown reference | rejected before `apply_paynow_result`; amount mismatch refused | unit (hash), 1240 test 8 |
| P6 | Result in OFF/TEST mode | send Paid while mode off/test | not credited, kept open, admins alerted; credited once after LIVE | 1240 tests 3–10 |
| P7 | Reversal / refund after credit | Paynow refund on a credited top-up | flagged for a human, never auto-debited below reserved funds | 1240 (`refund_due` flag) |
| P8 | Settlement reconciliation | compare Paynow settlement report with `payments` + `wallet_transactions` for the day | totals equal; `financial_reconciliation()` all OK | `financial_reconciliation()` checks |
| P9 | Wallet credit idempotency | same reference twice, two IPNs at once | one wallet line | S1, 1240 test 11 |
| P10 | Commission reservation and consumption | accept → complete; accept → cancel | 7% reserved once, charged once / released in full | 1050, 1171, S7, S9 |
| P11 | Account closure refund | request → super admin records refund with reference | balance → 0, one refund line, promo untouched, deletion unblocked | 1280 |

Merchant configuration expected (owner confirms with Paynow): integration ID/key for the **company** merchant account,
result URL `https://www.conz.co.zw/api/public/paynow-ipn` (the existing IPN route), return URL `/wallet`, currency
USD, `paynow_mode` set by a super admin with step-up and reason (`admin_set_paynow_mode`).

**Owner decision needed:** merging #162 stops new Paynow top-ups at once (the app treats a missing mode as off), even
before 0190 is applied. Until LIVE is approved, drivers get credit only from the $20 promo or an admin-recorded credit
(`admin_request_wallet_credit` → second admin approves). How a driver pays ConZ for that credit in the meantime is a
payment-handling question for the owner and the accountant/lawyer, not a code change.

## 5. Launch checklist (status 27/11; code existing is not approval)

| Item | Type | Status |
| --- | --- | --- |
| POTRAZ data-controller licence and DPO | Legal | **Open.** Not claimed anywhere; Privacy names POTRAZ only as the complaints authority |
| ZIMRA FDMS / fiscalisation of commission | Legal / tax | **Open.** See `docs/compliance/ZIMRA-PAYNOW-COMPANY-READINESS-2026-11-27.md`; company TIN to add when issued |
| Paynow approval of Commission Credit | Provider | **Open.** No written approval |
| Company merchant account and bank settlement | Provider / banking | **Open** |
| Terms and Privacy legal review (promo credit, closure refunds, liability, disputes) | Legal | **Open.** Wording is consistent with the code (tests guard it) but not lawyer-reviewed |
| Processor regions (Africa's Talking, AI gateway) | Legal | **Confirm** (data protection pack) |
| Driver onboarding and verification | Operational | Built (verification, 90-day re-check, document expiry after 0191); needs a named admin owner and response time |
| Customer and driver support | Operational | Contact e-mail published; no staffed hours or SLA defined |
| Dispute and incident procedures | Operational | Built (disputes, incident cases after 0192); written procedure for admins not yet adopted |
| Admin MFA | Operational | Authenticator optional; "required" switch OFF; 0/2 owners enrolled. Recommend both enrol, then switch on |
| Backup and recovery | Operational | Workflow exists; **needs** `PROD_DATABASE_URL` + `BACKUP_PASSPHRASE` secrets; restore never rehearsed |
| Monitoring | Operational | Vercel runtime logs; no alerting configured |
| Release rollback | Operational | App: Vercel instant rollback to previous deployment. DB: undo scripts per migration |
| Real Android phone test | Verification | **Not done** (`docs/implementation/CONZ_PLATFORM_TEST_PLAN.md` A1–A12) |
| Staging backend test | Verification | **Not done** (staging paused) |

## 6. Acceptance tests (run 27/11 on the combined branch, all 14 PRs merged locally; not production)

- pgTAP: 122 files, 2,662 tests, 0 failures (includes 1171 transport request journey, 1280 account closure).
- Unit: 1,167 passed; typecheck, security lint, production build: pass.
- Race scripts: S1–S13 (concurrent IPNs, approvals, accept_bid, completion, cancel) and P1–P5 pass.
- DB-backed Paynow IPN test: 10/10.
- Browser (local stand-in, not a backend): booking at 360 px, both journeys, pricing switch off and on, double tap.
- Not done: real phone, staging backend, production smoke test, real Paynow.

## 7. Next stage (after this release passes acceptance; not started)

Marketplace intelligence, preserving `create_dispatch_wave`, `driver_open_jobs`, `find_next_loads_for_driver`,
one-active-job-per-driver and the offer expiry rules:
- driver–job matching on distance, truck type/capacity, verification and rating;
- fair opportunity distribution (rotation so the same drivers are not always first);
- busy drivers excluded from new immediate jobs (extend the one-active-job rule to dispatch);
- no duplicate offers to the same driver for the same job;
- personalised job discovery in the driver feed;
- backhaul / return-load recommendations (extend `find_next_loads_for_driver`);
- both booking types (transport only and materials and transport) in all of the above.
