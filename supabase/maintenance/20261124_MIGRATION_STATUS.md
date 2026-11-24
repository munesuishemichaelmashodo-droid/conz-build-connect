# Migration status and disposition, 24/11/2026

Live latest: `20261111120000` (0169). Checked read-only against production on 24/11/2026.

## Applied live but not recorded under their git version (fix: history repair)

0072–0102 and 0104–0108 (36 files). All 136 functions they define exist live. Six live-only versions duplicate them
under other numbers. Fix: `20261124_migration_history_repair.sql` (metadata only; owner runs it by hand in the SQL
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

"Parked" files stay in git because the pgTAP suite builds them; they must not be applied to production while parked.
Retired: Payonify 0167/0168 were never on `main` (see `docs/payments/archive/`).

## Production apply order (each needs the owner's go; never automatic)

1. History repair script (metadata only) — separate review.
2. 0141 (no-op on production), 0129.
3. 0170.
4. 0171 (SQL editor).
5. 0172 (SQL editor).
6. 0173 (SQL editor), after 0171.
After each: record the version in `schema_migrations`, then re-run `select * from public.financial_reconciliation()`.
