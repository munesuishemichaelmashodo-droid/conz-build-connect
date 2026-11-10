# ConZ: decisions and actions that need the owner

Nothing here was done. Each item says what is blocked and the safest default.

| # | Item | Why it needs you | Safe default meanwhile |
| --- | --- | --- | --- |
| 1 | ~~Legal company name~~ **Decided 09/11 (owner): "Navysky Innovations (Private) Limited" is the entity.** "Sky Innovations Limited" is not used | None | Code and legal pages already use the Navysky name; no change needed |
| 2 | ~~Protected demo accounts~~ **Decided 09/11 (owner):** keep `munesuishemichaelmashodo@gmail.com` and `ngaatendwew@gmail.com` (both super admins, both in `super_admin_owners`); clear the rest, **except `web***@gmail.com` (kept on the owner's answer)**. Method chosen: anonymise + lock (the app's own deletion path; job, payment and audit history stay, with no name attached). **9 accounts cleared 09/11** (verified). **3 still locked but not yet scrubbed: `con***`, `taw***`, `mas***`** | **Your 3 steps to finish it:** (a) Admin > Jobs: cancel the 2 stuck test jobs that are `in_progress` since 13/08 and 16/08 (they block `con***` and `taw***`; one has a super admin as driver); (b) Supabase Dashboard > Storage > `driver-docs`: delete the folders of `con***` (7 files) and `mas***` (3 files): I cannot do it without a service key; (c) tell me, and I scrub the remaining 3 | The 3 logins are banned (reversible) |
| 3 | ~~$20 promo commission credit~~ **LIVE 09/11 (approved by the owner as demo money).** One-time $20 commission credit, not cash, not withdrawable, not transferable; replaces first-job-free. Your own account received the only grant (the other eligible accounts were locked or already used the free job). **Your action: have your lawyer read the new Terms sentence** ("Each newly verified Driver receives a one-time promotional commission credit of $20 ..."): it is legal wording | Terms wording review | Switch can be turned off by a super admin (`admin_set_promo_credit`); undo script restores the old function bodies (first-job-free itself cannot be restored per driver) |
| 4 | **Turn on delivery-only (transport) pricing** (`system_settings.transport_pricing_enabled`) and re-check the $500 cap | Money rule | Off (your 09/11 decision) |
| 5 | **Licensed truck-profile road router** instead of the free car-profile router | Cost/provider choice | Free router with a stated caveat |
| 6 | **Payment providers**: Paynow settings, Payonify (PR #38, not merged), Linkwa (treated as unapproved) | Provider credentials/legal | No change; handover doc will list questions |
| 7 | **Apple/Google store actions, iOS project, signing, bundle IDs** | Store and signing | Android build-only; iOS "not ready" |
| 8 | **Vercel Production**: set `VITE_SUPABASE_PROJECT_ID=ovwrsocjmkpiygipmrdk` (it currently carries the staging id; code now derives the MCP issuer from the URL, so this is hygiene) | Dashboard setting | Code already safe |
| 9 | ~~Staging paused~~ **Done 09/11:** `conz-staging` stays paused. The Payonify sandbox (#82), passkey staging (#91) and payments-left (#85) tasks stay blocked until you restore it | Plan limit | Left paused |
| 10 | ~~`venmax-admin` restore~~ **Done 09/11:** `venmax-admin` is `ACTIVE_HEALTHY` | None | None |
| 11 | Lawyer/regulatory questions in `CONZ-COMMISSION-CREDIT-RISK-NOTE.md` (commission credit, directors, ZIMRA TIN for the company) | Legal conclusions | None made |
| 12 | Real-device tests (Android phone, push delivery) | Needs hardware. **Script ready: `CONZ_PLATFORM_TEST_PLAN.md` (about 20 minutes, 12 steps)**. Evidence today: 0 native push tokens ever registered; 6 web-push subscriptions | Reported as unverified |
| 13 | Repair `schema_migrations` for 0077-0108 before any `supabase db push` | Touches migration history | Never run `db push` |
| 14 | ~~Deposit rule (F-AGR-1)~~ **Built 09/11** to the spec's rule (Driver proposes, Customer accepts): migration 0162 + card change, pgTAP 930 (22 tests), undo script tested. Live since 09/11 (production had 0 agreements) | None needed unless you want the old behaviour back | Undo: `supabase/rollbacks/20261109170000_0162_rollback.sql` |

---

## Consolidated handover, 10/11/2026 (supersedes earlier status messages)

Nothing below has been executed. Production on 10/11: 15 accounts, 94 jobs, 54 stored files, all intact.

### 1. Production hard delete (prepared, NOT run, on hold)
- **Would empty** every table in `public` except the kept list. Rows on 09/11: notifications 751, job_dispatch_offers 94, jobs 94, messages 88, bids 52, payments 44 (12 paid), wallet_transactions 38, admin_audit_log 36, wallet_audit_log 35, reconciliation_runs 32, job_evidence 26, price_quotes 24, payment_events 23, cancellation_events 18, job_delivery_pins 15, platform_ledger 10, tour_progress 10, wallet_topup_requests 6, customer_ratings 5, ratings 5, trucks 5, disputes 4, push_subscriptions 4, driver_availability 3, job_supply_confirmations 2, reports 2, job_route_points 1, pin_attempts 1, promo_credit_ledger 1, wallet_withdrawal_requests 1; the rest are already empty.
- **Would delete** 13 of the 15 sign-in accounts (with their profiles, roles, wallets, driver profiles by cascade), including the admin/driver account holding $70.81 and the three locked accounts.
- **Kept:** the two owner super-admin accounts (profile, roles, driver profile; wallets and test stats set to zero), and `system_settings`, `material_prices`, `material_price_buckets`, `small_load_settings`, `material_supply_locations`, `suppliers`, `supply_research_candidates`, `super_admin_owners`, `app_secrets`. Kept tables do not reference wiped tables.
- **Storage objects:** not touched by this step (see 2).
- **Safety built in:** one transaction; rolls back if a kept table's row count changes or the result is not exactly 2 accounts / 2 profiles / 2 wallets.
- **Backup evidence: NONE.** No export of production has been taken, and the Free plan has no automatic backups as far as we know. After the wipe there is no way back without one. A backup must exist and be test-read first.
- **Recovery plan (to build before any approval):** a GitHub Action that runs `pg_dump` of production into a private artifact, using a database password the owner stores as a GitHub secret (never in chat); verify the dump restores into the local test stack; only then ask for approval. The 12/10 procedure is in `docs/security/CONZ-BACKUP-RESTORE-PROCEDURE-2026-10-12.md`.
- **What the owner will see:** an approval card in the Claude app for the Supabase tool `execute_sql` on project `conz-build-connect`, showing the SQL (it begins `do $wipe$` and contains `truncate table` and `delete from auth.users`). The exact wording of the card is the app's and is not known to Claude. It times out after 60 seconds if unanswered and then nothing runs.
- Open point for an accountant: 12 payments are marked paid; confirm none is real money that must be kept on record before financial rows go.

### 2. Stored files (54)
- `job-proof-photos` 29 files (49.6 MB), `driver-docs` 20 files (21.1 MB; 10 of them are the two owners' own documents and should stay), `chat-media` 5 files (0.3 MB).
- SQL cannot remove them (the file bytes would remain). Safest route: the owner deletes them in Supabase Dashboard > Storage, bucket by bucket, after the backup in 1; in `driver-docs`, leave the two owner folders. No key is pasted anywhere.
- KYC: identity documents should be kept only as long as there is a reason (an active driver account, an open dispute, a legal duty). How long Zimbabwean law requires or allows is a question for the lawyer (item 3); until answered, delete only documents of test accounts.

### 3. Sentence for the lawyer (live in the Terms)
"Each newly verified Driver receives a one-time promotional commission credit of $20. It can only be used to pay Con Z commission, has no cash value, and cannot be withdrawn or transferred."
Ask: is this wording sound for a non-cash promotional credit, and does it create any stored-value or refund obligation? Also ask the KYC retention period.

### 4. Android phone test
Steps A1 to A12 with expected results are in `docs/implementation/CONZ_PLATFORM_TEST_PLAN.md` section 2 (about 20 minutes, Android 10+, the APK from the latest `build-android-apk` CI run). The key ones: A2 Google sign-in returns to the app; A5 allowing notifications shows no error; A6 a job notification arrives with the screen off; A9 camera and location work; A12 the back button behaves. Record results in section 5 of that file.

### 5. Paynow top-up test
There is no separate sandbox in use: the integration went live on 13/08. A real $1 test needs, from the owner: the Paynow merchant account active and able to receive; the integration ID and key present in Vercel Production; the result URL in the Paynow dashboard pointing at `https://www.conz.co.zw/api/paynow-ipn`; an EcoCash or card to pay $1; then start the top-up from Wallet and confirm the credit appears. Runbook: `docs/security/CONZ-PAYNOW-1USD-TEST-RUNBOOK.md`. Whether BuySafe holds top-ups (PR #18) is a Paynow account question.

### 6. Payonify PR #38: four medium findings (source review only, nothing tested)
| Finding | Impact | Fix |
| --- | --- | --- |
| Test-mode guard only checks that the database address contains the production id | A mis-set environment could let a fake sandbox charge mark a real job paid | Allow-list the staging project, refuse test mode on production, add a database-side refusal |
| Auto-payouts ignore the withdrawals switch and the limited-wallet flag | Real money leaves with no off switch except removing a key | `payouts_enabled` setting, default off; skip limited wallets |
| Payout number can be changed with no delay | A hijacked driver session redirects the next payout | Hold payouts 24 h after a change, or require the PIN |
| Payouts stuck in "sending" retry forever | A possible double payout if the provider's duplicate window expires | Cap attempts or age, then park for review and alert admins |
Plan: separate branch from current `main`, renumber its migrations after 0166, fix the four with a test each, re-run the full suites, second review, staging only. Not to be merged or switched on without the owner.

### Classification
- **Owner approval required:** the hard delete (only after a verified backup); deleting stored files; any merge or switch-on of Payonify; Cloudflare Access or DNS changes.
- **Owner action required:** add the database password as a GitHub secret for the backup job; delete files in the Storage dashboard; Paynow $1 test; set `VITE_SUPABASE_PROJECT_ID` in Vercel Production; restrict the Firebase key.
- **Physical device required:** Android test A1 to A12; iOS (no project exists).
- **Lawyer/provider required:** promo-credit sentence; KYC retention; Paynow BuySafe; Linkwa account and commission-allocation decision.
- **Safe for autonomous engineering:** backup job and restore rehearsal; the optional admin authenticator (branch `security/admin-authenticator`: migration 0166, undo and test written, NOT yet run or applied); admin permissions matrix; Payonify fixes on a branch; Linkwa handover update; escrow duplicate-payment index (escrow is off).
