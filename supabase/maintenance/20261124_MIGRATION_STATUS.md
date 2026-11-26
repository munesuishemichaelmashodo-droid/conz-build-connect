# Migration status and disposition, 24/11/2026

Live latest: `20261111120000` (0169). Checked read-only against production on 24/11/2026.

## Applied live but not recorded under their git version (fix: history repair)

0072–0102 and 0104–0108 (36 files). All 136 functions they define exist live. Six live-only versions duplicate them
under other numbers. Grants checked 24/11: for all 91 function signatures that 0072–0108 GRANT or REVOKE, live
EXECUTE for PUBLIC/anon/authenticated/service_role equals the last statement in git (90 match; the 91st, the 8-argument
`create_material_sourcing_request`, is deliberately dropped by 0088). The 10 tables they create have RLS on, no anon
access and no authenticated INSERT/UPDATE/DELETE/TRUNCATE. Fix: `20261124_migration_history_repair.sql` (metadata only; owner runs it by hand in the SQL
editor; never an agent or CI). Undo: `20261124_migration_history_repair_undo.sql`.

How to run it (both files ship in read-only `check` mode; change only the `c_mode` line):
1. `check` — read-only preconditions; must print `PREFLIGHT OK`. Any `STOP:` means history is not in the expected
   state: do not continue, investigate.
2. `dry_run` — full repair, then rolls itself back with `DRY RUN OK`; nothing kept.
3. `apply` — commits. Prints `APPLIED: rows N -> N+30` and the backup's row count and md5.
4. `supabase migration list` — the 36 git versions show as applied on both sides.
Keep `supabase_migrations.schema_migrations_backup_20261124_repair` until at least one later migration has been
applied and recorded cleanly. The script never reuses an existing backup (it stops if the name exists) and records the
backup's count and md5 in its comment; the undo re-checks them, removes only the 36 rows the repair added, restores
only the six it removed, and keeps any version recorded since. Local proof: `20261124_migration_history_repair.test.sh`
(34 checks on a throwaway local Postgres, including every refusal path).

**Even after the repair, do not use `supabase db push`:** the parked files below (0130–0132, 0137) are in git but not
live, so a push would apply them. Apply migrations one at a time in the SQL editor and record each version.

## On `main` but not live: disposition

| Migration | What it does | MVP? | Disposition |
| --- | --- | --- | --- |
| 0129 `admin_launch_switches` | Audited super-admin setter for launch switches (escrow/withdrawals, wallet cap) | Yes: the Settings "Launch switches" card calls it; 0172 then removes its `max_job_budget` option | **Apply** (owner go). No DROP |
| 0130 `referral_qualification_fix` | Referral reward qualification | No | **Parked**: do not apply for the MVP |
| 0131 `conz_points` | ConZ points programme | No | **Parked** (the profile points card hides itself when the functions are missing; the admin Points page shows an empty state) |
| 0132 `verification_sla` | Business-hours SLA timeline for driver review | No | **Parked** (admin verifications screen shows no SLA when missing) |
| 0137 `public_open_job_previews` | Signed-out preview of open requests at `/open-jobs` | Optional | **Parked** unless the owner wants `/open-jobs` live (today it shows an empty list) |
| 0141 `auth_signup_trigger` | Creates `on_auth_user_created` only if missing | Yes (test databases) | **Apply** (owner go): a no-op on production, which already has the trigger |
| 0170 `driver_public_profiles_verified_only` | Branch `fix/mvp-security` | Yes | Apply after merge (see `docs/release/2026-11-24-SECURITY-FIXES.md`) |
| 0171 `provider_commission_accounting` | PR #133: provider-paid jobs, payables, payouts, reversals (switches OFF) | Yes | Apply in the **SQL editor** (two allow-listed DROP CONSTRAINTs) after #133/#134 are deployed |
| 0172 `remove_job_price_cap` | PR #138: no $500 ceiling; large-job alert | Yes | Apply **after 0129**, SQL editor |
| 0173 `provider_post_payout_recovery` | Refund after a confirmed driver payout: recovery record, repaid / written off | Yes (needs 0171) | Apply **after 0171**, SQL editor (widens the ledger account CHECK) |
| 0174 `admin_totp_only_stepup` | Step-up accepts only an authenticator-app (TOTP) code; no-amr tokens refused; owner-only requirement switch | No app dependency (the app already uses TOTP) | Apply any time after review; no DROP |
| 0176 `direct_pay_launch` | Free first job retired whatever the promo switch says; drivers confirm a direct payment once (`direct_payment_confirmations`, `driver_confirm_direct_payment`) | Yes (direct-pay launch) | **LIVE 25/11/2026** (owner go; applied via `execute_sql` with a before-state guard, recorded `20261125100000`; after: tg_retire_free_first_job 803f4c68, driver_confirm_direct_payment 5180a7fa, RLS on, 0 rows, history 183 → 184, reconciliation OK). Tested: pgTAP 1100 + staging launch suite 25/11 (see `docs/payments/DIRECT-PAY-LAUNCH-2026-11-25.md`) |
| 0178 `safety_reports_and_paid_at` | Report categories + urgent flag (safety, fraud, harassment alert admins); `payments.paid_at` set when a payment becomes paid | Yes (trust and safety) | **NOT applied.** No DROP/DELETE. Prerequisites checked live 26/11 (0142 report grants). App copes with it missing. Undo: `supabase/rollbacks/20261126100000_0178_rollback.sql`. Tested: pgTAP 1120 (6/6) |
| 0179 `agreement_payment_terms_and_stages` | Agreement: driver's payment details, deposit timing/reason, cancellation terms, exact payment channel; `propose_job_agreement_terms`; per-stage direct payments (`direct_payment_stages`, append-only `direct_payment_stage_events`, `job_payment_plan`, customer claim / driver confirm / customer agree) | Yes (direct-pay MVP) | **NOT applied.** No DROP/DELETE. Apply after 0178. App falls back to the 0176 view when missing. Undo: `supabase/rollbacks/20261126110000_0179_rollback.sql`. Tested: pgTAP 1130 (34/34) |

"Parked" files stay in git because the pgTAP suite builds them; they must not be applied to production while parked.
Retired: Payonify 0167/0168 were never on `main` (see `docs/payments/archive/`).

## Production apply order (each needs the owner's go; never automatic)

Checked read-only on 24/11/2026 18:50 Harare: history 183 rows, latest `20261111120000`, no backup table, every
`financial_reconciliation()` check OK, and every function below is in exactly the "before" state its undo script
restores. One step per sitting; stop at the first mismatch.

**Fingerprint query** (comments and whitespace ignored, so the result does not depend on how a file was pasted):

```sql
select p.proname, left(md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s', '', 'g')), 8) as fp
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = any (array['<names>']) order by 1;
```

**Record a version** after each apply: `insert into supabase_migrations.schema_migrations (version, name) values ('<version>', '<name>');`
**After every step:** `select check_name from public.financial_reconciliation() where not ok;` returns no rows.

| # | Step | Needs first | How | Before → after (fingerprint) | Extra check after | Undo |
|---|---|---|---|---|---|---|
| 0 | History repair | — | SQL editor: `check`, `dry_run`, then `apply` | rows 183 → 213; 36 versions added, 6 stand-ins retired | `supabase migration list` shows 0072–0108 on both sides | `20261124_migration_history_repair_undo.sql` |
| 1 | 0174 `20261124140000` `admin_totp_only_stepup` | #144 merged (done) | SQL editor (no DROP, no delete) | require_aal2 9c57f886 → 9d3857f1; admin_note_authenticator_check 0d781d3b → 045b1c15; admin_set_authenticator_required 0b78c12e → 99a5450b | An owner signed in with Google in the last 12 h can still approve a money action (no authenticator yet, switch off) | `rollbacks/20261124140000_0174_rollback.sql` |
| 2 | 0141 `20261104120000` `auth_signup_trigger` | — | SQL editor | none (creates the trigger only if missing; it exists) | `select tgenabled from pg_trigger where tgname = 'on_auth_user_created'` = `O` | none needed |
| 3 | 0129 `20261103110000` `admin_launch_switches` | — | SQL editor | admin_set_launch_switch absent → 7f2bfe3c | anon cannot execute it; Settings "Launch switches" card saves | `rollbacks/20261103110000_0129_rollback.sql` |
| 4 | 0170 `20261124100000` `driver_public_profiles_verified_only` | — | SQL editor | view only | `pg_get_viewdef('public.driver_public_profiles')` contains `verification_status = 'verified'` | `rollbacks/20261124100000_0170_rollback.sql` |
| 5 | 0171 `20261124110000` `provider_commission_accounting` | #133/#134 deployed (done) | **SQL editor only** (2 DROP CONSTRAINT + ADD in one ALTER each) | account_deletion_blockers 2da2f549 → 77ccc87d; complete_job 04a9f9fa → c043234c; driver_can_accept e221918f → 0828da4e; driver_can_accept_for 11d4972e → 670abb1c; driver_confirm_delivery_pin 88a16018 → e093a376; financial_reconciliation 14cef976 → 7e6eac37; hold_job_commission ec580d5f → 09c63424; payments_guard_transition 13eff04c → 815f61a9; plus 21 new functions | `payment_provider` = `"none"`, `payouts_enabled` = `false`; `driver_payables`/`driver_payouts` exist with RLS on | `rollbacks/20261124110000_0171_rollback.sql` |
| 6 | 0172 `20261124120000` `remove_job_price_cap` | 0129 | **SQL editor only** (contains `delete from system_settings`) | admin_set_launch_switch 7f2bfe3c → 83144be6; launch_switches 04077d97 → dfc6d157; tg_enforce_launch_bid_limit 504befc0 → cb0662b3; tg_enforce_launch_job_limits 308268f1 → 8c01a654; new tg_jobs_large_job_alert c998a280 | no `max_job_budget` row; `large_job_alert_amount` = 1000; $100,000 checks unchanged | `rollbacks/20261124120000_0172_rollback.sql` (restores the $500 row) |
| 7 | 0173 `20261124130000` `provider_post_payout_recovery` | 0171, #143 merged | **SQL editor only** (widens the ledger account CHECK) | account_deletion_blockers 77ccc87d → 475f084c; new admin_open_post_payout_refund f2c72d46, admin_close_driver_recovery c56cf456, driver_recoveries_guard 18b6b56a | `driver_recoveries` exists, RLS on, 0 rows; unique index `driver_recoveries_repaid_reference_uidx` exists | `rollbacks/20261124130000_0173_rollback.sql` (refuses once rows exist) |
| 8 | 0176 `20261125100000` `direct_pay_launch` | none (independent of 0171-0175) | SQL editor or `execute_sql` (no DROP, no `delete from`) | tg_retire_free_first_job a64d6f52 → 803f4c68; new driver_confirm_direct_payment 5180a7fa | `direct_payment_confirmations` exists with RLS on and 0 rows; `select count(*) from driver_profiles where first_job_free_used is distinct from true` = 0 (it was 0 on 25/11) | `rollbacks/20261125100000_0176_rollback.sql` (keeps the table and its rows) |

Not in this sequence: parked 0130–0132 and 0137 (never apply for the MVP). Switches stay as they are:
escrow, withdrawals, provider collection (`payment_provider = "none"`) and payouts all OFF; delivery-only pricing OFF.
