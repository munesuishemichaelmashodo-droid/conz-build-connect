# ConZ — read-only reconciliation of production vs migrations 0077–0097 (12/10/2026)

Method (all read-only): built a local Postgres 16 stand-in from the 13/08 baseline plus git migrations through 0076,
applied 0077…0097 one at a time, and after each step snapshotted every object a migration touches (functions, tables,
columns, triggers, policies, constraints, indexes, each with an md5 of its normalised definition). The 217 objects touched
by 0077–0097 were then looked up in production with read-only catalog queries and compared. Hosted migration history was
not changed. No customer rows were read; only counts and catalog metadata.
Limits: stand-in is Postgres 16, production is 17.6; function hashes are over `pg_get_functiondef` with whitespace
collapsed, so comment or non-ASCII (encoding) differences count as "differs".

## 1. Headline findings

1. **Production is a partial, unrecorded mix.** History ends at `0076`. Yet 105 of the 217 touched objects exist live;
   most of `0082`, `0084`, `0087` (38/40) and parts of `0077`, `0079`, `0083`, `0085`, `0086` are live and byte-identical to git.
   Nothing from `0078` (PIN lock-out), `0088`, `0094`–`0097` is live except where noted. How it got there is unknown.
2. **Eighteen live objects match no repo version at all** (16 functions, 2 constraints). Where I could read them,
   the cause is encoding/line-ending corruption from how they were applied: bodies contain `\r\n`, and notification text
   such as `notify_kyc_reverification` and `run_financial_reconciliation` contains mojibake (`â€”`, `â†’`). Functions affected:
   `admin_grant_role`, `admin_referral_action`, `admin_set_commission(numeric,text)`, `anonymize_deleted_account`,
   `complete_job(uuid)`, `driver_available_jobs`, `driver_confirm_delivery_pin`, `driver_level_commission_multiplier`,
   `find_next_loads_for_driver`, `get_public_tracking`, `is_verified_driver`, `jobs_guard_insert`,
   `notify_kyc_reverification`, `resolve_dispute`, `run_financial_reconciliation`, `tg_validate_job_budget`. Constraints:
   `material_sourcing_requests_delivery_address_check`, `sourcing_custom_material_valid`.
   For 7 of them I read the live text (admin_grant_role, driver_confirm_delivery_pin, driver_level_commission_multiplier,
   is_verified_driver, jobs_guard_insert, notify_kyc_reverification, run_financial_reconciliation); for the other 11 the cause is
   inferred, not read. A full text diff on the restored copy is required before any replay.
3. **Deployed app and database are out of step right now.** `main` (head `eb288f1`, PR #6 merged 09/10 18:50 UTC, Vercel
   deployment reported success) has `src/lib/booking.functions.ts` calling `create_price_quote_for`. That function is created by
   `0080`, which is NOT live. The app is designed to fail closed (0080's header says so), so new quotes/bookings should fail.
   Not proven in a browser. Production data is consistent with this but also with low traffic: last quote 23/08, last job created 08/10,
   0 quotes and 0 jobs since the merge.
4. `CLAUDE.md`'s "only 0072 applied" is stale: `0073`–`0076` are recorded live.

## 2. Per-migration report

"Identical" = live object equals the repo definition produced by that migration. "Other repo version" = live object equals
a different step's repo version (an older one if the migration is not applied yet, a newer one if a later migration also
rewrote it). "No repo version" = live definition matches nothing the repo can produce.

| Migration | Objects changed | Live and identical | Missing live | Other repo version | No repo version | Dropped by migration |
|---|---|---|---|---|---|---|
| 0077 kyc_protection | 2 | 1 | 0 | 0 | 1 | 0 |
| 0078 pin_lockout_that_counts | 7 | 0 | 3 | 3 | 1 | 0 |
| 0079 roles_and_job_visibility | 8 | 3 | 0 | 0 | 5 | 0 |
| 0080 pricing_input_integrity | 8 | 0 | 4 | 1 | 2 | 1 |
| 0081 account_deletion | 2 | 0 | 0 | 1 | 1 | 0 |
| 0082 ledger_and_reconciliation | 20 | 17 | 0 | 0 | 3 | 0 |
| 0083 security_invariants | 2 | 1 | 0 | 0 | 1 | 0 |
| 0084 reconcile_live_only_objects | 1 | 1 | 0 | 0 | 0 | 0 |
| 0085 second_audit_fixes | 4 | 2 | 0 | 0 | 2 | 0 |
| 0086 commission_change_mfa | 2 | 1 | 0 | 0 | 1 | 0 |
| 0087 material_sourcing_requests | 40 | 38 | 0 | 0 | 2 | 0 |
| 0088 sourcing_workflow_integrity | 46 | 0 | 44 | 0 | 0 | 2 |
| 0089 geographic_dispatch | 6 | 0 | 4 | 2 | 0 | 0 |
| 0090 sourcing_quote_booking_radius | 2 | 0 | 1 | 0 | 1 | 0 |
| 0091 flat_commission | 7 | 0 | 1 | 5 | 1 | 0 |
| 0092 neutralise_level_commission_multiplier | 1 | 0 | 0 | 0 | 1 | 0 |
| 0093 payment_audit_fixes | 6 | 0 | 1 | 4 | 1 | 0 |
| 0094 withdrawal_payout_tracking | 9 | 0 | 7 | 2 | 0 | 0 |
| 0095 wallet_reservation_failed_payout_limits | 24 | 0 | 11 | 13 | 0 | 0 |
| 0096 delivery_proof_both_modes | 17 | 0 | 12 | 3 | 1 | 1 |
| 0097 withdrawal_pin_recovery | 24 | 0 | 24 | 0 | 0 | 0 |

### Per-migration verdict and replay safety

Replay safety below is about running the file against production's *current* state. "Data check" lines are read-only
production aggregates taken 12/10/2026 16:13 UTC.

- **0077 KYC protection** — `driver_profiles_guard_direct_write` live and identical; `notify_kyc_reverification` live with
  corrupted text. Replay rewrites function bodies (good: fixes the mojibake) and DROPs/recreates the five `driver docs`
  policies on `storage.objects`. Unsafe-ish: the live state of those storage policies was not compared, and storage policy DDL
  needs the storage admin role. Rehearse on the restored copy first.
- **0078 PIN lock-out** — not live (3 new functions missing; `set_withdrawal_pin`, `request_withdrawal` still the 0076/0077
  bodies). Additive and replay-safe by design; changes user-visible PIN error text and lock-out behaviour.
- **0079 roles and job visibility** — tracking-token trigger, `jobs_rotate_tracking_token` and the `Jobs visibility` policy are live
  and identical. Five functions are live with a different body (`admin_grant_role` live text already contains the 0079 "F8" step-up
  clause, so a 0079-era variant was applied). Replay overwrites them with repo text; safe once the text diff is reviewed.
- **0080 pricing input integrity** — `create_price_quote_for`, `consume_price_quote`, `price_quote_for_job`,
  `verified_quote_supply_for_job` missing. **Unsafe ordering:** it DROPs client-callable `create_price_quote(4 args)` and replaces
  `tg_validate_job_budget` (pricing validation on every booking) and `jobs_guard_insert`. Its header says: ship the compatible app first,
  then apply. The app on `main` is already the compatible one (finding 3), so this is the migration whose absence breaks quoting today.
- **0081 account deletion** — `account_deletion_blockers` live (equals the post-0083 version); `anonymize_deleted_account` live with an
  unrecognised body. That function irreversibly anonymises a user when called. Do not replay until its live body is diffed against the repo.
- **0082 ledger and reconciliation** — 17 of 20 identical (table, trigger, policy, `financial_reconciliation`, referral ledger trigger,
  `admin_approve_*`, `credit_wallet_from_payment`). `complete_job(uuid)`, `resolve_dispute`, `run_financial_reconciliation` live with
  unrecognised bodies. Money paths: diff before replay. `platform_ledger_account_check` constraint is live and identical.
  Data check: 4 `reconciliation_runs` rows exist; ledger accounts present: `user_wallets`, `opening_balance`.
- **0083 security invariants** — `account_deletion_blockers` identical; `notify_kyc_reverification` unrecognised (mojibake). Replay safe after diff.
- **0084 reconcile live-only objects** — `wallet_transactions_immutable` live and identical. Replay a no-op for that object; its storage
  trigger/policies (`storage_evidence_guard`) were not compared and need storage admin rights.
- **0085 second audit fixes** — `admin_reconciliation_report` identical; `admin_referral_action` and `resolve_dispute` unrecognised.
  `admin_money_actions_kind_check` live and identical. Replay safe after diff.
- **0086 commission change MFA** — `admin_set_commission(numeric)` identical; `(numeric,text)` unrecognised (non-ASCII). Replay safe after diff.
- **0087 sourcing requests** — table, 3 policies, trigger, 2 indexes and 38/40 objects identical. The two check constraints live differ from
  git. The file creates them inside `CREATE TABLE IF NOT EXISTS`, so replay will **not** correct them (silent skip). Data check: 0 rows,
  so correcting them later (drop and re-add) is risk-free today. **0087 must not be recorded as applied** without your approval (standing rule).
- **0088 sourcing workflow integrity** — 44 objects missing, nothing live. Drops the 8-arg `create_material_sourcing_request` and the
  `Admins update sourcing requests` policy (replaced by RPCs). The new CHECK constraints and unique indexes are added to a table with 0 rows: safe.
  App-dependent: the sourcing screens need the new RPCs.
- **0089 geographic dispatch** — new dispatch functions missing; `accept_dispatch_offer` and `create_dispatch_wave` are still the pre-0089
  bodies. Adds `system_settings` rows. Changes who is offered a job: behavioural, low data risk.
- **0090 sourcing quote booking radius** — `sourcing_quote_authorizes_booking` missing; `tg_validate_job_budget` unrecognised (replaced again here).
- **0091 flat commission** — **behavioural and money-affecting.** Rewrites `hold_job_commission`, `release_escrow_and_complete`, `complete_job`,
  `driver_can_accept*` (live ones still hold the 0076-era level-multiplier maths). Data check: 6 jobs are live right now (1 accepted, 5 in progress,
  all direct-pay); they would settle under the new 7% / first-job-free rule after the migration. Apply in a quiet window and tell drivers.
- **0092 neutralise level multiplier** — `driver_level_commission_multiplier` live body is the old 0.80–1.00 table. Replay safe.
- **0093 payment audit fixes** — creates unique index `uq_wd_one_pending_per_user`. Data check: 0 users with two pending withdrawals → safe today.
  Re-check on the day (a new pending request could create a duplicate only if the app allows it; the index would then fail the whole transaction).
- **0094 withdrawal payout tracking** — adds `paid_*` columns and `wd_payout_requires_approved_and_reference`. Data check: 1 withdrawal ever (`approved`, never
  paid) satisfies the constraint (it only restricts rows with `paid_at` set). Safe.
- **0095 reservation / failed payout / limits** — adds `wallets.withdrawal_reserved`, backfills reservations from pending withdrawals (data check: 0 pending →
  no row changes), replaces `wallet_withdrawal_requests_status_check` (live row is `approved`: allowed), creates `uq_topup_ref_per_method`
  (data check: 0 duplicate live top-up references among 3 pending + 1 approved → safe). The file tolerates duplicates with a NOTICE rather than failing.
- **0096 delivery proof both modes** — **breaking for the old app.** Drops `complete_job(uuid)` (the live one, unrecognised body) in favour of
  `complete_job(uuid, text)`; backfills a PIN for the live jobs (data check: **6 live jobs have no PIN** → 6 rows inserted with a 7-day expiry); marks the PINs
  of completed jobs consumed (3 PIN rows exist); `require_aal2` and the payout step-up trigger change admin behaviour. The new app must be deployed immediately
  after (the new app falls back to the no-PIN call only when the function is missing).
- **0097 withdrawal PIN recovery** — 24 objects missing; additive; adds the 24 h post-reset withdrawal pause. Data check: 1 withdrawal PIN currently set. Safe.

## 3. Rehearsal evidence (stand-in, 12/10/2026)

- 0077→0097 applied in order, one transaction each, from a clean 0076 build: 21/21 OK. Same result replaying 0077→0097 over a DB already at 0087.
- pgTAP on the final schema: 27 files / 788 assertions pass (stand-in). CI on commit `390cc8d` (real local Supabase): `database-tests`, `build-and-verify`, `build-android-apk` all success.
- Not rehearsed, because it needs a real dump: the exact production starting state (the 18 unrecognised objects, the storage policies, real row data).

## 4. Recovery / reconciliation plan (no hosted history is edited)

1. **Freeze**: no merge to `main`, no `db push`, no dashboard SQL edits until step 5.
2. **Back up first** (procedure doc, sections A–F), including a schema-only dump. This captures the unrecognised bodies as evidence.
3. **Find the source** of the unrecorded 0077–0087 objects: check Supabase Dashboard > Database > Migrations / Logs for the session that ran them, and
   any Lovable/other connector with write access. Until known, treat any new merge as able to change production.
4. **Restore the dump to a scratch project** and run `scripts/ops/schema-fingerprint.sql` on production and on the copy; they must agree. Then diff the 18
   unrecognised function bodies (`pg_get_functiondef` text) against git to confirm "encoding/CRLF only", or find real hotfixes that exist only in production.
5. **Fix the repo, not the history**: if a live body contains a genuine fix missing from git, commit it to a new migration. Keep the 0077–0097 files as the source of truth.
6. **Rehearse on the scratch copy**: apply 0077→0097 in order; run pgTAP and `scripts/db-concurrency-check.sh`; run the app against it.
7. **Release** (only with your explicit approval): fresh backup the same day → quiet window → apply 0077→0097 (each in a transaction) → deploy the app that matches
   `390cc8d` immediately → run `financial_reconciliation()` → smoke test one direct-pay and one escrow job → Paynow $1 test per the runbook.
   Record migration history using the supported tool only after the objects genuinely match; do not hand-insert rows to look consistent.
8. **Rollback**: structural rollback = restore the pre-release dump to a new project and repoint (Free plan has no PITR); keep the pre-release dump for 30 days.

## 5. Unresolved risks

- Unknown origin of unrecorded production changes; other automated writers may exist.
- Live bodies of 11 of the 18 unrecognised functions were not read; "encoding only" is an inference for those.
- Storage policies (`driver docs`, evidence guard) not compared; KYC document access depends on them.
- Quoting/booking on the deployed app is probably failing closed until 0080 is applied (not browser-verified).
- No backup exists. Release is blocked until one is taken and a restore is proven.
- Postgres 16 stand-in vs 17.6 production; no real-device, browser or Paynow tests.
- `0087` marking, payout step-up for all admin roles, and `app_secrets` handling still need your decisions.
