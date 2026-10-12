# ConZ production rollout plan — migrations 0077–0097 (DRAFT FOR APPROVAL, nothing applied)

Evidence date: 2026-10-12. Hosted project `conz-build-connect` (`ovwrsocjmkpiygipmrdk`). Hosted migration history ends at
`0076_admin_money_controls`. Branch `feature/nationwide-sourcing` carries 0077–0097 (0097 is local-only, not yet pushed).
The deployed app is `main` (Vercel auto-deploy), which already contains the migration FILES 0077–0086 but the database does not.

## Read-only production snapshot (counts only, taken 2026-10-12)
15 users · 75 jobs (9 completed) · 6 jobs in progress, ALL direct-pay · 0 escrow jobs in progress · 3 delivery-PIN rows ·
1 withdrawal ever, 0 pending, no user with two pending · 12 paid payments · 6 verified drivers · 0 negative wallets.
Meaning: the data is small and clean, so the new unique indexes (e.g. one pending withdrawal per user) cannot collide today,
and the only customers affected by the PIN change are the owners of the 6 live direct-pay jobs.

## Are any migrations destructive?
No data is dropped. The `drop` statements remove policies, triggers, constraints or functions that are re-created in the same
file (e.g. 0077 storage policies, 0078 withdrawal functions, 0096 `complete_job(uuid)` replaced by `complete_job(uuid, text default null)`).
Data-changing statements: 0096 backfills PIN rows/expiry for accepted jobs (3 rows today). Recovery from a bad run = restore from
backup / point-in-time recovery (no per-migration down scripts exist). Policy-only reverts: drop `trg_withdrawal_payout_stepup` (0096),
drop `trg_withdrawal_after_pin_reset` (0097).

## Compatibility with the running app (the exact break)
* OLD app (`main`) + NEW database: the customer "Confirm delivery" button calls `complete_job(_job_id)` with no code and the old screen
  shows a code only for escrow jobs. After 0096 a direct-pay job cannot be completed by the old app ("The delivery code is required…").
  Escrow driver-PIN entry keeps working. => keep the gap between "database upgraded" and "new app live" to minutes.
* NEW app + OLD database: `complete_job(_job_id, _pin)` does not exist → PostgREST "could not find the function". The new app
  (src/lib/deliveryConfirm.ts) retries once without the code, and sends no code when it has none, so direct-pay completion still
  works on the old database. BUT sourcing/booking screens need 0087–0090, so the app must not be live long before the database.
* Therefore the safe order is: database first (quiet window), app deploy immediately after.

## Ordered sequence (needs your approval for steps 3 and 5; nothing below has been run)
1. Confirm a recent backup / point-in-time recovery exists (Supabase dashboard → Database → Backups). BLOCKER until confirmed.
2. Final code on a branch with a green CI run (database-tests + build-and-verify); read the pgTAP log for the assertion count.
3. Dry run: restore the latest backup to a scratch Supabase project and apply 0077–0097 in order there. Specific risk to prove:
   0077/0084 create or drop policies on `storage.objects` — on hosted Supabase that can need the storage admin role.
   Do NOT replay history before 0077.
4. Pick a quiet window (ideally none of the 6 live direct-pay jobs are waiting for confirmation) and tell the drivers/customers.
5. Apply 0077 → 0097 in filename order, one at a time (`apply_migration` or SQL editor), each followed by
   `select * from public.financial_reconciliation()` (all checks must pass). 0087 specifically needs your explicit approval
   (standing rule: never mark it applied without approval).
6. Merge to `main` (Vercel deploys) immediately after step 5. Smoke-test: sign in as customer, book (sourcing path), driver bids,
   accept, driver uploads delivery photo, customer sees the code, confirm with the code → job completes, commission = 7% (or first job free).
7. Verify: `financial_reconciliation()` all pass; wallets total unchanged; no error spike in logs.
8. Then, and only then, run the $1 Paynow controlled test per `CONZ-PAYNOW-1USD-TEST-RUNBOOK.md`.

## Rollback
Before step 5 completes: restore backup. After: app rollback in Vercel is instant but an OLD app cannot confirm direct-pay deliveries
(see above), so prefer fixing forward; the two policy triggers can be dropped without downtime.
