# ConZ — backup and restore procedure for the owner (Supabase Free plan)

Supersedes the checklist sections of `CONZ-BACKUP-RESTORE-REHEARSAL-2026-10-12.md`. Nothing here needs Claude to see a
password, token, connection string or customer row. **Never paste those into chat, a GitHub issue, a commit or a CI log.**
This repo is public: GitHub Actions logs and artifacts are public too, so do not run backups there.

Production project ref: `ovwrsocjmkpiygipmrdk`. Free plan: no scheduled backups, no point-in-time recovery, so this
procedure is the only safety net. Do it before ANY migration or deploy, and again right before the release.

## What each method preserves

| Component | Method | Preserved | NOT preserved / back up separately |
|---|---|---|---|
| A. Database schema + data (public, auth, storage metadata) | `pg_dump` / `supabase db dump` | tables, rows, constraints, indexes, views, functions, triggers, RLS policies, grants, enums, sequences; `auth.users` rows incl. password hashes and MFA factor rows; `storage.buckets` / `storage.objects` **rows**; `public.app_secrets` rows | extension binaries (recreated), `cron.job_run_details` (log, skipped), Supabase-managed roles, the Vault key |
| B. Roles | `supabase db dump --role-only` | custom role attributes/settings | passwords of managed roles |
| C. Storage object files | S3-compatible copy (`rclone`) or `supabase storage cp -r` | every file in `driver-docs` (KYC), `job-proof-photos`, `chat-media` (~69 MB total) | bucket settings (see D) |
| D. Bucket configuration | SQL query below + dashboard screenshot | public flag, size limit, MIME limits | storage policies are in the A schema dump |
| E. Auth settings | Dashboard > Authentication (screenshots/notes) or Management API `GET /v1/projects/<ref>/config/auth` with your personal access token in an env var | providers, redirect URLs, templates, password rules, MFA settings | Google OAuth client secret (keep in your password manager), JWT signing keys |
| F. Edge Function secrets | `supabase secrets list` shows NAMES + digests only | the list of which secrets exist | **the values** (VAPID keys, FCM service-account JSON, push hook secret, Paynow id and key): keep them in your password manager; no tool exports them. Function code is in git. |
| G. Vercel / Paynow / GitHub configuration | Vercel dashboard > Settings > Environment Variables (copy names; values to the password manager); Paynow dashboard (integration id, key, result/return URLs) | env var names, URLs | secret values are never in a dump |
| H. Vault (`vault.secrets`) | none | row ciphertext is in the dump | **the encryption key is not**: after a restore the secrets are unreadable, re-create them |

## Who/where each step runs

| Step | Needs |
|---|---|
| Create DB password / read connection details | Your logged-in Supabase dashboard (Project Settings > Database > Connection string, "Session pooler") |
| Run dumps, encrypt, restore | A laptop or PC you control, with `supabase` CLI, `psql`/`pg_dump` (v17 client, to match 17.6), `age` or `gpg`, `rclone` |
| Storage S3 keys | Dashboard > Storage > S3 connection > create access key |
| Auth/bucket/secret/Vercel/Paynow notes | Dashboard logins for Supabase, Vercel, Paynow |
| Scratch restore target | A second, empty Supabase project (Free plan allows two) or the local Docker stack |
| What Claude can do without any secret | read-only catalog fingerprints (already done), rehearse migrations on a stand-in, review diffs you paste that contain **no** customer data |

## Procedure

### 0. Prepare (5 min)
1. Pick a quiet time. Write down date/time and the latest migration version from Dashboard > Database > Migrations.
2. On the laptop: `supabase --version`, `pg_dump --version` (client 17), `age --version`. Make an empty folder, e.g. `~/conz-backup-YYYY-MM-DD`, on an encrypted disk. Never inside a git repo.

### 1. Database dump (A and B)
```bash
cd ~/conz-backup-$(date +%F)
read -r -s -p "DB password: " PGPASSWORD; export PGPASSWORD; echo      # typed, not echoed, not saved
export PGHOST=<session pooler host from dashboard> PGPORT=5432 PGDATABASE=postgres PGSSLMODE=require
export PGUSER=postgres.ovwrsocjmkpiygipmrdk
DB="postgresql://$PGUSER@$PGHOST:$PGPORT/$PGDATABASE"      # password comes from PGPASSWORD

supabase db dump --db-url "$DB" --role-only          -f roles.sql
supabase db dump --db-url "$DB"                       -f schema.sql
supabase db dump --db-url "$DB" --data-only --use-copy -f data.sql
pg_dump "$DB" --format=custom --no-owner --no-privileges \
        --schema=public --schema=auth --schema=storage -f conz-full.dump
```
These only read. If the pooler host fails, use the dashboard's IPv4 session pooler string, not the direct host (IPv6 only).
Record sizes: `ls -l`. Expect `conz-full.dump` in the low tens of MB (DB is ~41 MB; `cron` run logs are excluded).

### 2. Extra read-only exports (D, and fingerprints)
```bash
psql "$DB" -X -A -t -c "select id, public, file_size_limit, allowed_mime_types from storage.buckets" > buckets.txt
psql "$DB" -X -A -t -c "select jobname, schedule from cron.job order by 1"                       > cron-jobs.txt
psql "$DB" -X -A -t -f /path/to/repo/scripts/ops/schema-fingerprint.sql | sort                     > fingerprint-prod.txt
```
The fingerprint contains names and hashes only. Safe to share with Claude if you want a comparison.

### 3. Storage files (C)
```bash
# one-time: rclone config  -> type s3, provider Other, endpoint from dashboard S3 settings, the S3 access key you created
rclone copy conz:driver-docs      ./storage/driver-docs
rclone copy conz:job-proof-photos ./storage/job-proof-photos
rclone copy conz:chat-media       ./storage/chat-media
rclone check conz:job-proof-photos ./storage/job-proof-photos --one-way
```
Use `copy`, not `sync`, so nothing can ever be deleted from the source by mistake. Expected counts: driver-docs 19, job-proof-photos 24, chat-media 3 objects.
Delete the S3 access key in the dashboard when done.

### 4. Notes for items that cannot be dumped (E, F, G, H)
- Auth: screenshot Dashboard > Authentication > Providers, URL Configuration, Email Templates, Password/MFA settings. Note whether leaked-password protection is on (currently off).
- Edge Function secrets: `supabase secrets list --project-ref ovwrsocjmkpiygipmrdk` (names only); confirm each value exists in your password manager.
- Vercel: copy env var NAMES from Settings > Environment Variables; confirm values are in your password manager.
- Paynow: note integration id, return/result URLs; key in the password manager.

### 5. Seal the backup
```bash
sha256sum * storage/**/* > SHA256SUMS 2>/dev/null
cd .. && tar cf - conz-backup-$(date +%F) | age -p > conz-backup-$(date +%F).tar.age    # passphrase into your password manager
```
Copy the `.tar.age` to two places (e.g. a USB disk and cloud storage you control). Then securely delete the plaintext folder. Do not email or upload the unencrypted files anywhere: the dump contains user emails, phone numbers, password hashes, KYC document paths and the push hook secret.

### 6. Prove the backup restores (never skip) — into a SCRATCH target only
1. Create a new empty Supabase project (name it `conz-restore-test`) or run `supabase start` locally. Confirm its ref is **not** `ovwrsocjmkpiygipmrdk` before running anything.
2. Restore:
```bash
RESTORE="postgresql://postgres:<scratch project db password>@<scratch pooler host>:5432/postgres"   # typed by you, scratch only
psql "$RESTORE" -v ON_ERROR_STOP=0 -f roles.sql
pg_restore --no-owner --no-privileges --clean --if-exists -d "$RESTORE" conz-full.dump
```
Expect a few harmless "already exists" errors for Supabase-managed objects. Anything about missing tables in `public` is a failure.
3. Verify (counts only):
```sql
select count(*) from auth.users;                                  -- 15
select status, count(*) from public.jobs group by 1;              -- 75 total, 9 completed
select count(*) from public.payments where status in ('paid','released');   -- 12
select count(*) from public.wallets where balance < 0;            -- 0
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';   -- 181
select count(*) from pg_policies where schemaname='public';       -- 129
```
(Numbers are the 12/10/2026 snapshot; production may have moved. Use your own `fingerprint-prod.txt` as the real reference.)
4. Run the fingerprint on the copy and diff: `diff fingerprint-prod.txt fingerprint-restore.txt` must be empty (cron lines may differ until jobs are re-created).
5. Re-create what a dump cannot carry (section "What each method preserves" rows D–H) only if you want to run the app against the copy.
6. Upload storage files to the copy only if the rehearsal needs them.

### 7. Rehearse migrations on the scratch copy (never production)
```bash
supabase link --project-ref <scratch ref>          # confirm the ref twice
# apply files in order against the scratch DB with psql, one transaction each:
for f in supabase/migrations/20261008020000_0077*.sql ... 20261012200000_0097*.sql; do
  psql "$RESTORE" -v ON_ERROR_STOP=1 -1 -f "$f" || break
done
```
Do not use `supabase db push` or `supabase migration up` on production. Then run the pgTAP/concurrency suites and the app against the scratch project.
If you want Claude's help, share only the error text and the names of failing objects.

### 8. Go / no-go for release
Release is allowed only when ALL are true: a sealed backup < 24 h old exists in two places; the restore test (step 6) matched; the 0077–0097 rehearsal on the restored copy passed; the unrecorded-objects question in `CONZ-RECONCILIATION-0077-0097-2026-10-12.md` section 4 is answered; you have approved in writing.

## Schedule
Because the Free plan has no scheduled backups: take this backup weekly while real money is moving, plus before every release. Upgrading to Pro adds daily backups; PITR is a separate $100/month add-on. Weekly manual dumps are a workable stop-gap, not a substitute.
