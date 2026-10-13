# ConZ — manual backup, restore and migration rehearsal (12/10/2026)

Production: Supabase project `ovwrsocjmkpiygipmrdk`, Free plan (no scheduled backups, no PITR).
Nothing in this document was run against production except read-only catalog/aggregate queries.
No credentials, connection strings or customer data appear here; keep it that way.

## 1. What was and was not done in this session

| Step | Status |
|---|---|
| Inspect repo Supabase config | Done. `supabase/config.toml` project_id = `ovwrsocjmkpiygipmrdk`; `scripts/db-test.mjs` builds from the 13/08 baseline plus later files. |
| Real dump of production | **Not done.** No authorised database credentials exist in this session, and pulling customer rows through chat tooling is prohibited. Steps for you are in section 4. |
| Restore of a real dump | **Not done** (nothing to restore). Steps in section 5. |
| Migration rehearsal 0077-0097 | Done on a **stand-in** local Postgres 16 (not the Supabase stack, not Postgres 17, not production data). See section 6. |
| Production changed | No. Read-only `execute_sql` / `list_migrations` only. |

## 2. Critical finding: production is a partial, unrecorded mix of 0077-0087

`supabase_migrations.schema_migrations` ends at `0076_admin_money_controls`. But live objects show otherwise
(whitespace-normalised md5 of `pg_get_functiondef`, compared with a database built from git):

- Byte-identical to the repo's 0077-0087-era versions: `account_deletion_blockers`, `admin_reconciliation_report`,
  `financial_reconciliation`, `jobs_rotate_tracking_token`, `ledger_post_referral_reward`,
  `create_material_sourcing_request` (8-arg 0087 form), `admin_approve_withdrawal`, `admin_approve_topup`,
  `credit_wallet_from_payment`, `admin_set_commission(numeric)`.
- Tables/triggers live that migrations 0077-0087 create: `reconciliation_runs`, `material_sourcing_requests`,
  `trg_jobs_rotate_tracking_token`, `trg_ledger_referral_reward`, `wallet_transactions_immutable`.
- Present in production but with a body that matches neither the 0076 nor the 0087 build: 33 functions
  (e.g. `anonymize_deleted_account`, `is_verified_driver`, `notify_kyc_reverification`, `run_financial_reconciliation`,
  `complete_job`, `request_withdrawal`, `set_withdrawal_pin`, `tg_validate_job_budget`).
- Absent live: everything from 0078 (`check_withdrawal_pin`, `pin_lock_duration`, `withdrawal_pin_failure_result`),
  0088 (`consume_price_quote`, `create_price_quote_for`, `price_quote_for_job`, `verified_quote_supply_for_job`,
  `material_sourcing_status_history`, `idempotency_key`), 0094-0097 columns/tables/triggers.

Meaning: someone or something applied parts of 0077-0087 to production without recording them (possible causes:
SQL run by hand, a connector/auto-sync after the PR #6 merge, or a partial run). Also, `0073`-`0076` ARE recorded live,
so CLAUDE.md's "only 0072 applied" is out of date.

Consequences:
1. A rehearsal that starts from "0076 + nothing" is not production's real starting state.
2. The only trustworthy starting state is a restore of a real dump (section 5).
3. Do not run `supabase db push` / `migration up` against production until the live state is reconciled; it would try
   to replay 0077-0087 over objects that already exist.
4. Find out how those objects got there before merging anything else to `main`.

## 3. What a database dump does and does not preserve

Required in the backup set:
- **Schema** for `public` (tables, constraints, indexes, views, functions, triggers, RLS policies, grants, enums, sequences).
- **Data** for `public`, plus `auth` (users, identities, mfa factors, sessions optional) and `storage.buckets` / `storage.objects` **metadata rows**.
- **Roles/grants**: `supabase db dump --role-only` (custom role settings only; Supabase's built-in roles are recreated by the platform).
- **Extensions list**: pg_cron, pg_net, pgcrypto, supabase_vault, uuid-ossp, pg_stat_statements (recreated on a new project, not copied).
- **Cron jobs**: live in the `cron` schema (9 jobs); dump `cron.job` rows or re-create from migrations; `cron.job_run_details` (22 MB) is log data, skip it.
- **`app_secrets` table (public)**: contains the push hook secret. Treat the dump as a secret.

NOT preserved by a database dump (back up or re-create separately):
- **Storage object files**: 3 private buckets, about 69 MB (`driver-docs` KYC, `job-proof-photos`, `chat-media`). The dump holds only metadata rows.
- **`vault.secrets`**: encrypted with a key that is not in the dump; values are unrecoverable on another project. Re-create secrets.
- **Edge Function secrets** (VAPID keys, FCM service-account JSON, push hook secret, Paynow integration id/key) and **edge function code deploys** (code is in the repo; secrets are not).
- **Auth dashboard settings** (providers, Google OAuth client, redirect URLs, email templates, leaked-password protection, JWT secret/keys).
- **Storage bucket configuration** (public flag, size limits, MIME limits), API settings, network restrictions, custom domains.
- **Vercel environment variables**, Paynow dashboard settings, GitHub secrets.
- Realtime publication membership is in the schema dump only if you include `supabase_realtime` publication DDL; verify after restore.

## 4. Taking the production backup (you run this; no secrets in git or chat)

Use the **session pooler** (port 5432 on the pooler host shown in Dashboard > Connect). The direct host is IPv6-only.
Do it from a machine you trust, with disk encryption, not from a GitHub Action on this public repo.

```bash
# 1. get the pooler connection details from the dashboard; DO NOT paste them into chat or git
read -r -s -p "DB password: " PGPASSWORD; export PGPASSWORD; echo
export PGHOST=<pooler host from dashboard> PGPORT=5432 PGUSER=postgres.ovwrsocjmkpiygipmrdk PGDATABASE=postgres PGSSLMODE=require

mkdir -p ~/conz-backup-$(date +%F) && cd ~/conz-backup-$(date +%F)

# 2. read-only dumps (none of these modify production)
supabase db dump --db-url "postgresql://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE" -f roles.sql --role-only
supabase db dump --db-url "postgresql://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE" -f schema.sql
supabase db dump --db-url "postgresql://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE" -f data.sql --data-only --use-copy
# Alternative for a single restorable archive (schemas public, auth, storage; excludes cron run logs):
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage -f conz-full.dump

# 3. record integrity + encrypt, then delete the plaintext
sha256sum * > SHA256SUMS
tar cf - . | age -p > ../conz-backup-$(date +%F).tar.age     # or: gpg --symmetric --cipher-algo AES256
```

Storage files (separate from the dump). Create Storage S3 access keys in Dashboard > Storage > S3 settings, then:

```bash
rclone sync conzsupabase:driver-docs      ./storage/driver-docs      --read-only
rclone sync conzsupabase:job-proof-photos ./storage/job-proof-photos --read-only
rclone sync conzsupabase:chat-media       ./storage/chat-media       --read-only
```
(`supabase storage cp -r ss:///driver-docs ./storage/driver-docs --experimental` also works.) KYC documents are
sensitive personal data: keep them encrypted and off GitHub.

Store the encrypted archive in two places (e.g. your drive + an external disk). Note the production migration
version and DB size alongside it.

## 5. Restore into an isolated target (never into production)

Preferred: a **new, empty, separate Supabase project** (Free plan allows two active projects) or the local stack
(`supabase start`, Docker). Check the target's ref is NOT `ovwrsocjmkpiygipmrdk` before every command.

```bash
# local stack
supabase start
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f roles.sql
pg_restore --no-owner --no-privileges --clean --if-exists -d "postgresql://postgres:postgres@127.0.0.1:54322/postgres" conz-full.dump
# (or schema.sql then data.sql with psql)
```
Then re-create what a dump cannot carry: bucket config, vault secrets, edge-function secrets, auth settings (section 3).
Upload storage files only if the rehearsal needs them.

## 6. Verification checklist after restore (counts only, no row dumps)

Compare against the production snapshot of 12/10/2026: PostgreSQL 17.6; 15 users; 75 jobs (9 completed);
12 paid payments; 6 verified drivers; 181 public functions; 129 policies; 59 tables; 55 triggers; 0 negative wallets;
9 cron jobs; buckets `chat-media` 3 / `driver-docs` 19 / `job-proof-photos` 24 objects.

```sql
select count(*) from auth.users;
select count(*) from public.jobs;  select status, count(*) from public.jobs group by 1;
select count(*) from public.payments where status in ('paid','released');
select count(*) from public.wallets where balance < 0;
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
select count(*) from pg_policies where schemaname='public';
select * from public.financial_reconciliation();      -- every check should be ok = true
select count(*) from cron.job;                        -- 9, or re-create from migrations
```
Also diff function fingerprints (md5 of whitespace-normalised `pg_get_functiondef`) restore vs production: must be empty.

## 7. Migration rehearsal order (on the restored copy only)

1. Record the restored copy's function fingerprints and `schema_migrations` (expected: ends 0076, plus the unrecorded 0077-0087 objects from section 2).
2. Decide how to reconcile the unrecorded objects (record 0077-0087 as applied after diffing, or let the files replay; section 8 shows the files are replay-safe in the stand-in).
3. Apply 0088 ... 0097 in order, one transaction each; stop at the first error.
4. Run `supabase test db` (pgTAP: expected 27 files / 788 assertions) and `scripts/db-concurrency-check.sh`.
5. Run `npx tsc --noEmit`, `npx vitest run`, `npm run build`, and exercise: accept bid -> deliver -> PIN -> settle (direct and escrow), withdrawal request/approve with aal2, PIN recovery, sourcing request.
6. Only then plan production: fresh backup the same day, quiet window, apply, deploy the app immediately after (see `CONZ-ROLLOUT-PLAN-2026-10-12.md`).

## 8. Stand-in rehearsal results (12/10/2026) — NOT the real Supabase stack

Environment: Postgres 16 in the cloud container with shim for auth/storage/pgTAP; baseline `20260813999999` + git migrations. Honest limits: different major version than production, no real data, no Supabase platform roles/extensions.

- Build to 0076 (clean): OK.
- Apply 0077 -> 0097 in order, one transaction each, starting from 0076 with a seeded old-style accepted direct-pay job: **21/21 migrations OK**.
  - Backfill check: that accepted job got a delivery PIN row with an expiry and unconsumed (1 row).
  - Completion path: delivery proof created, job reaches settlement path.
  - `financial_reconciliation()`: all 11 checks true except `wallets_match_transactions`, which is a seed artefact (test wallets were funded directly without ledger rows; migration-free, reconciliation correctly flags it).
  - 0 negative balances/reservations.
- Replay of 0077 -> 0097 over a database that already contains 0077-0087 (approximating production's partial state): **21/21 OK** (replay-safe).
- pgTAP stand-in suite on the final schema: **27 files / 788 assertions, 0 failed**. Earlier CI run (GitHub, real local Supabase) on the same code was green, but its assertion count could not be read.
- App: `tsc --noEmit` clean; vitest 17 files / 149 tests pass.
- Not covered: 0077/0084 `storage.objects` policy changes need the Supabase storage admin role (on a real project run as `postgres` via the SQL editor/CLI and confirm); restore from a real dump; Postgres 17; real-device/browser/Paynow tests.
