# Migration status and disposition, 24/11/2026

Live latest: `20261111120000` (0169). Checked read-only against production on 24/11/2026.

## Applied live but not recorded under their git version (fix: history repair)

0072–0102 and 0104–0108 (36 files). All 136 functions they define exist live. Six live-only versions duplicate them
under other numbers. Fix: `20261124_migration_history_repair.sql` (metadata only, owner runs it in the SQL editor,
undo `20261124_migration_history_repair_undo.sql`). **Until it has run, never use `supabase db push`.**

## On `main` but not live: disposition

| Migration | What it does | MVP? | Disposition |
| --- | --- | --- | --- |
| 0129 `admin_launch_switches` | Audited super-admin setter for `max_job_budget`, `max_wallet_balance`, escrow/withdrawal switches | Yes: needed to change the $500 cap without SQL; the Settings "Launch switches" card calls it | **Apply** (owner go). No DROP |
| 0130 `referral_qualification_fix` | Referral reward qualification | No | **Parked**: do not apply for the MVP |
| 0131 `conz_points` | ConZ points programme | No | **Parked** (the profile points card hides itself when the functions are missing; the admin Points page shows an empty state) |
| 0132 `verification_sla` | Business-hours SLA timeline for driver review | No | **Parked** (admin verifications screen shows no SLA when missing) |
| 0137 `public_open_job_previews` | Signed-out preview of open requests at `/open-jobs` | Optional | **Parked** unless the owner wants `/open-jobs` live (today it shows an empty list) |
| 0141 `auth_signup_trigger` | Creates `on_auth_user_created` only if missing | Yes (test databases) | **Apply** (owner go): a no-op on production, which already has the trigger |
| 0170 `driver_public_profiles_verified_only` | Branch `fix/mvp-security` | Yes | Apply after merge (see `docs/release/2026-11-24-SECURITY-FIXES.md`) |

"Parked" files stay in git because the pgTAP suite builds them; they must not be applied to production while parked.
Retired: Payonify 0167/0168 were never on `main` (see `docs/payments/archive/`).
