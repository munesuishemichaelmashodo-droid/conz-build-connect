# Release readiness — PRs #29, #30, #31 and migration history (26/10/2026)

Read-only review. Nothing was merged, deployed, applied or written to production. Production evidence comes from
`SELECT` queries against project `ovwrsocjmkpiygipmrdk` on 26/10/2026. "Local" means a fresh database built by
`scripts/db-test.mjs` from the 13/08 baseline plus every later migration file on branch `release/integration-review`.

## 1. The three PRs

| PR | Branch → base | Head | CI on head (26/10) | Migration | Files shared with the others |
| --- | --- | --- | --- | --- | --- |
| #29 | `fix/no-self-offers` → `ccr-4fab7e0d-2b8j1o` | `859aca1` | green at `45df802`; the renumber commit re-runs it | 0117 (renumbered, see §4) | `jobs.$id.tsx` (#30, #31), `OfferCard.tsx` (#31) |
| #30 | `pricing/engine-audit` → same | `71f1483` | green (build, unit, pgTAP, Android) | 0118 | `jobs.$id.tsx` |
| #31 | `marketplace/driver-proposed-source` → same | `94f52de` | green at `d2dd36f`; re-runs on `94f52de` | none | `jobs.$id.tsx`, `OfferCard.tsx` |

All three branch from the same base commit `01368bf` and have no code dependency on each other.

**Trial merge** (scratch worktree, nothing pushed), in the order #29 → #30 → #31: #29 merges cleanly. #30 and #31 each conflict
on **one import line** at the top of `jobs.$id.tsx` (each branch added an import on the same line). Keeping both lines
resolves it. The combined result passes `tsc --noEmit` and 400 unit tests. Whoever merges second and third must resolve
that one line. Any merge order works.

## 2. Migration history: what production records vs what it runs

Production's `supabase_migrations.schema_migrations` records 0072–0076, 0098 and 0109–0112, and nothing for
0077–0097 or 0099–0108.

### 2a. Version numbers that differ from git

| Migration | Recorded live as | Git file version | Effect on `supabase db push` |
| --- | --- | --- | --- |
| 0072 | 20261007231311 | 20261007210000 | treated as not applied (re-runs) |
| 0073 | 20261008045004 | 20261007220000 | same |
| 0074 | 20261008045240 | 20261007230000 | same |
| 0075 | 20261008045317 | 20261008000000 | same |
| 0076 | 20261008045551 | 20261008010000 | same |
| 0098 | 20261013093236 | 20261012300000 | same |
| 0109–0112 | match git | match | fine |

So the history gap is 0072–0108, not 0077–0108 as CLAUDE.md says. Renaming the files to the live versions would
reorder them (0073 would sort after 0077), so the safe fix is metadata-only: see §5.

### 2b. Does production run what the files say? (0077–0108)

Method: for all 106 functions defined in 0077–0108, MD5 of the body with whitespace removed, plus security mode and
`search_path`, compared between production and the local build. Where they differed, every historical definition
in git was hashed to find which one production runs. All tables, columns, triggers, indexes, cron jobs and
settings named in those files were checked for existence. Row-level security policies on the affected tables were
compared by rule text.

Result: **97 of 106 functions identical.** All 5 tables, 16 columns, 20 triggers, 9 indexes, 2 cron jobs and 5 settings
exist. Policies match (5 policy names in the files were renamed by later files, identically on both sides).

| Migration | Functions it last defines | Match production | Other objects | Status | Safe next action |
| --- | --- | --- | --- | --- | --- |
| 0077 kyc_protection | 0 (2 redefined later) | `driver_profiles_guard_direct_write` = 0077 body (0115 not live) | — | Live | Record |
| 0078 pin_lockout | 4 | 4 | — | Live | Record |
| **0079 roles_and_job_visibility** | 6 | 5 (+1 differs) | 1 policy | **Live with drift** | See §3.2 |
| 0080 pricing_input_integrity | 3 | 3 | — | Live | Record |
| 0081 account_deletion | 1 | 1 | — | Live | Record |
| 0082 ledger_and_reconciliation | 4 | 4 | 4 | Live | Record |
| 0083 security_invariants | 2 | 2 | — | Live | Record |
| 0084 reconcile_live_only_objects | 0 | — | 2 triggers | Live | Record |
| 0085 second_audit_fixes | 2 | 2 | — | Live | Record |
| 0086 commission_change_mfa | 1 | 1 | — | Live | Record |
| 0087 material_sourcing_requests | 0 | — | 4 | Live (0 rows) | Record |
| 0088 sourcing_workflow_integrity | 15 | 15 (2 differ only by 0115's `search_path`) | 15 | Live | Record |
| 0089 geographic_dispatch | 5 | 5 | — | Live | Record |
| 0090 sourcing_quote_booking_radius | 1 | 1 | — | Live | Record |
| 0091 flat_commission | 3 | 3 | — | Live | Record |
| 0092 neutralise_level_multiplier | 1 | 1 | — | Live | Record |
| 0093 payment_audit_fixes | 2 | 2 | 1 | Live | Record |
| 0094 withdrawal_payout_tracking | 1 | 1 | 4 | Live | Record |
| 0095 wallet_reservation… | 15 | 15 | 6 | Live | Record |
| 0096 delivery_proof_both_modes | 11 | 11 | 4 | Live | Record |
| 0097 withdrawal_pin_recovery | 5 | 5 | 4 | Live | Record |
| 0098 bridge_create_price_quote_for | 0 | — | — | Live, recorded under another version | §2a |
| 0099 guard_photo_timestamps | 2 | 2 | 1 | Live | Record |
| 0100 fix_admin_set_diesel_price | 0 (redefined by 0103) | production runs the **0100** body | — | Live | Record |
| 0101 stock_is_advisory | 5 | 5 | — | Live | Record |
| 0102 decline_dispatch_offer | 1 | 1 | — | Live | Record |
| **0103 pricing_setters_superadmin_stepup** | 2 | **0** | — | **Not applied** | See §3.1 |
| 0104 job_supply_confirmation | 1 | 1 | 1 | Live | Record |
| 0105 accept_dispatch_offer_lock_order | 1 | 1 | — | Live | Record |
| 0106 long_haul_rate_round_trip | 1 | 1 | — | Live | Record |
| 0107 mvp_launch_switches | 7 | 7 | 5 | Live | Record |
| 0108 fix_budget_trigger_unassigned_loc | 1 | 1 | — | Live | Record |

Function grants: apart from defaults that differ between the local test stack and Supabase (`service_role`, and
`PUBLIC` on trigger functions, which Postgres won't run outside a trigger), only two harmless lookups differ:
`pin_lock_duration(int)` and `driver_level_commission_multiplier(level)` are callable by anyone in production. Both are
pure calculations with no data access. Low risk; no action needed for the release.

## 3. Findings that change the plan

### 3.1 0103 was never applied: any admin can change the price multiplier (security)

Production's `admin_set_demand_multiplier` accepts **any admin** and asks for no step-up. Neither does
`admin_set_diesel_price` (super admin only, no step-up). 0103 makes both super-admin plus step-up; 0111's Google
re-sign-in satisfies the step-up. The multiplier scales every future quote by up to 3×. The admin settings
screen already turns a step-up refusal into "sign in again" (`admin.settings.tsx`, `failWithStepUp`), so applying 0103
needs no app change. 0103 has no DROP; its "rollback" is the current production bodies (0100 for diesel, the
baseline for the multiplier).

### 3.2 0079: one live-only edit in `find_next_loads_for_driver`

`driver_available_jobs` and `get_public_tracking` match 0079 except for comments and formatting (someone re-typed them).
`find_next_loads_for_driver` differs by one token: in the "good" recommendation tier, production computes the
anchor-to-origin distance with `cos(radians(c.delivery_lat))` where 0079 (and 0057 before it) uses
`cos(radians(_anchor_lat))`. Git is the correct haversine. Effect: only the "good / possible" label on next-load
suggestions for drivers; no money, no access. Options: re-apply the 0079 body for that one function (has no DROP), or
leave it and record the drift. Either way, never apply 0079 whole again: its other statements are already live.

### 3.3 Two open PRs used the same migration version

0116 (PR #18, draft) and 0117 (PR #29) were both `20261026120000`. Fixed: 0117 is now `20261026121000` (commit `859aca1` on
#29; SQL unchanged). Version order stays 0113 (`20261025100000`, PR #11) < 0114 < 0115 < 0116 < 0117 < 0118.

### 3.4 Merging to `main` doesn't apply migrations by itself

The "Supabase Preview" check is skipped on every PR, and 0077–0108 stayed unrecorded through earlier merges to `main`
(PR #7 on 24/10). So no automatic push to production is wired up. Migrations reach production only when someone
applies them.

## 4. 0117 and 0118

| | 0117 no offers on own job | 0118 pricing engine v1.3 |
| --- | --- | --- |
| Changes | `tg_guard_bid_insert`, `accept_bid` | `compute_material_offer`; read policy on `system_settings` (+2 keys) |
| DROP | none | none |
| Undo file matches production today | yes, both bodies hash-equal | yes, body and policy text equal |
| Overlaps with 0114/0115/0116 or each other | none | none |
| Prerequisites | 0109 (live): `accept_bid` builds on it | 0106 (live) |
| Old app with migration | works: the app never offers on your own job | works: old app turns a null cost into 0 and hides that row |
| New app without migration | works: #29's app has no dependency | works: #30's app treats the new fields as optional |
| Changes live quotes | no | no (no qualifying market history; null inputs never reach it) |

So 0117 and 0118 can be applied in either order, before or after their app deploys. Doing them after the deploy is
still cleaner, because each PR's tests then describe what is live.

## 5. Release plan (each step needs your explicit approval; none is done)

| # | Step | Who/what | Approval needed | Evidence it worked |
| --- | --- | --- | --- | --- |
| 1 | Merge #29, #30, #31 into `ccr-4fab7e0d-2b8j1o` in any order; resolve the one import line in `jobs.$id.tsx` | GitHub | "Merge #29, #30, #31" | CI green on the working branch |
| 2 | Merge the working branch into `main` (Vercel deploys) | GitHub/Vercel | "Release to main" | production smoke test: offer, choose, offers with "Loads at", price check |
| 3 | Apply **0103** (security) with `execute_sql`, then record it | Supabase | "Apply 0103" | both setter bodies hash to the 0103 file; an admin (non-super) gets "Only super admins" |
| 4 | Apply 0117, record as `20261026121000` | Supabase | "Apply 0117" | `tg_guard_bid_insert`/`accept_bid` hash-equal to the file |
| 5 | Apply 0118, record as `20261026130000` | Supabase | "Apply 0118" | `compute_material_offer` hash-equal; one quote compared before/after |
| 6 | Decide 0079 drift (§3.2) | owner | "Re-apply 0079's find_next_loads body" or "leave it" | hash equal to git, or a note in CLAUDE.md |
| 7 | Repair the history (metadata only): mark git versions of 0072–0102 and 0104–0108 as applied; mark the six live-only versions of 0072–0076 and 0098 as reverted | Supabase CLI `supabase migration repair` | "Repair migration history" | `supabase migration list` shows local = remote up to 0112 |
| 8 | Only after 7: anyone may use `supabase db push` | — | — | — |

Commands for step 7, for review (NOT run). Take a copy of the table first:
`select * from supabase_migrations.schema_migrations order by version;` (save the result).

```
supabase migration repair --status applied 20261007210000 20261007220000 20261007230000 20261008000000 20261008010000 \
  20261008020000 20261008030000 20261008040000 20261008050000 20261008060000 20261008070000 20261008080000 \
  20261008090000 20261008100000 20261008110000 20261010100000 20261010110000 20261010120000 20261010130000 \
  20261010140000 20261011200000 20261011210000 20261012000000 20261012010000 20261012100000 20261012200000 \
  20261012300000 20261012310000 20261012320000 20261012330000 20261012340000 20261012360000 20261012370000 \
  20261013160000 20261013170000 20261019230000
supabase migration repair --status reverted 20261007231311 20261008045004 20261008045240 20261008045317 \
  20261008045551 20261013093236
```

0103 (`20261012350000`) is left out on purpose: it is recorded at step 3 when applied. Not part of this release:
0113 (#11), 0114/0115 (on the working branch, prepared, not applied), 0116 (#18, draft). 0114 and 0115 are already
on the working branch, so step 2 deploys app code written alongside them; their headers say what the app needs
before they are applied.

## 6. Owner decisions still open

1. Quotation requests: turn on `sourcing_requests_enabled` only when someone will answer them (§ PR body).
2. Supplier names on the price check: Pomona and Davis Granite are "listed suppliers" with no recorded agreement
   (see `docs/marketplace/SUPPLIER-CANDIDATES-2026-10-26.md`).
3. 0079 drift (§3.2).
4. Audited setter for 0118's two new settings (until then, super admin edits rows directly).
5. Offer messages have no length limit in the database (the app caps at 80 + 300 characters).
