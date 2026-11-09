# Con Z Connect — project context for Claude Code

Construction logistics marketplace for Zimbabwe (river sand, stones, gravel,
etc. delivered by tipper truck). Customers post jobs, drivers bid, in-app
chat + live GPS tracking + escrow or direct pay. Owner: Ngaatendwe Tembo
(a.k.a. Ngaatendwe Webster / Webster Ngaatendwe in test data), based in
Zimbabwe.

## Stack

- Frontend: TanStack Start (React 19, Vite, Tailwind v4), deployed on **Vercel** —
  production domain https://www.conz.co.zw (also conz-build-connect.vercel.app)
- Android: Capacitor shell `com.conz.app` that loads https://www.conz.co.zw
  (`capacitor.config.ts`, `android/`; CI workflow `android-build.yml`)
- Backend: **Supabase** (Postgres + Auth + Storage + RLS), project ref
  `ovwrsocjmkpiygipmrdk`
- Repo: `munesuishemichaelmashodo-droid/conz-build-connect`, branch `main`
  (Vercel auto-deploys on push to `main`)
- Payments: Paynow (Zimbabwe) — went **live** 13/08/2026 after ZIMRA tax
  clearance

## Commands

- `npm run typecheck` (= `tsc --noEmit`) and `npm run build` (build + smoke test of
  the compiled server) — run both before every commit.
- `npm test` — Vitest unit tests (`tests/unit/`, 268 tests on 24/10/2026).
- `npm run lint:security` — security-critical files must be lint-clean (CI gate).
  `npm run lint` covers everything but the repo still has old `any`/format debt;
  lint changed files with `npx eslint <files>` instead of `eslint .` (it scans
  `.vercel`/`android` and hangs).
- `npm run test:db` (= `node scripts/db-test.mjs test`) — pgTAP database tests
  (`supabase/tests/database/`, 43 files / 1061 tests on 24/10/2026) on a fresh local
  Supabase in Docker built from the 13/08 baseline + every later migration. First
  `node scripts/db-test.mjs start`. Never touches the hosted project.
- Local signed-in screens with sample data: `scripts/dev/README.md`
  (`node scripts/dev/mock-supabase.mjs` + `npm run dev` pointed at it).
- CI (`.github/workflows/verify-build.yml`) runs typecheck, security lint, unit
  tests, build and the pgTAP suite on pushes to `main` and on pull requests into
  `main` only — a working branch gets CI once a PR is opened.

## Migration workflow (important)

Migrations live in `supabase/migrations/`, named
`YYYYMMDDHHMMSS_NNNN_description.sql` where NNNN is a sequential 4-digit
counter (currently up to 0112) kept **on top of** the raw timestamp-named
files from early development. Each migration applied live since 23/10 has an
undo script in `supabase/rollbacks/` holding the exact pre-change production
definitions. Always:

1. Check the latest applied migration version live (not just what's in git —
   see "Known issue" below) before picking the next number.
2. Write the migration file first, then apply it live, then `tsc`+build,
   then commit+push.

**Hard rule, effective 13/08/2026, applies to every session (chat
computer-use and Claude Code alike): a migration is never applied to the
live Supabase project without its `.sql` file committed to git in the same
sitting.** "I'll commit it later" is how the drift below happened, twice.
If you apply something live, the commit (or at least the file, staged) must
exist before you consider the task done — no exceptions for hotfixes,
one-liners, or "just a grant/RLS tweak."

**Known issue — git/DB drift (now reconciled):** Multiple parallel sessions
(this repo gets worked on from both a chat interface with computer-use and
from Claude Code sessions, sometimes concurrently) applied migrations
directly to the live Supabase project without ever committing the
corresponding `.sql` file. As of 13/08/2026 this had grown to ~50 live-only
migrations — not just the two originally flagged
(`drop_legacy_admin_set_material_price_text_overload`,
`restrict_admin_from_settings_and_topups`) but an entire block from
01–11/08/2026 that never made it into git at all, plus `0030`, a second
`0033`, and `0034b`. Rather than reconstruct each one individually (not
reliably recoverable), the whole live schema was snapshotted via
introspection and committed as
`supabase/migrations/20260813999999_baseline_reconcile_with_live.sql` —
tables, constraints, indexes, functions, triggers, views, RLS policies, and
grants, exactly as they stand live, written defensively (safe to replay
against either a fresh DB or the current live one). `supabase/config.toml`
was also fixed — it pointed at the wrong project ref
(`nyivrhdpxsrxyfmexxkn`) and now correctly points at `ovwrsocjmkpiygipmrdk`.
**Before starting any DB work, still compare the live migration list
against `supabase/migrations/` and diff** — the hard rule above is meant to
stop this recurring, but verify rather than assume.

## What's been fixed recently (13/08/2026, today)

- **Admin role restrictions** — super_admin vs admin two-tier access on
  revenue data (RLS + dashboard scoping).
- **Withdrawal PIN bug** — `set_withdrawal_pin` RPC no-op'd for users
  without a `driver_profiles` row; fixed via upsert.
- **UI decluttering pass** (reorg only, no functional changes) —
  `jobs.$id.tsx`, `wallet.tsx`, `RoleDashboard.tsx`, `profile.tsx`,
  `admin.settings.tsx`, `admin.revenue.tsx`, `admin.ledger.tsx`,
  `admin.disputes.tsx`, `admin.audit.tsx`, `admin.reports.tsx`, and
  `admin.verifications.tsx` all regrouped for clarity.
- **Migration drift reconciled** — git's migration history had fallen ~50
  migrations behind live (see "Migration workflow" below for the full
  story). Closed with a single introspected baseline migration
  (`20260813999999_baseline_reconcile_with_live.sql`) plus a hard rule
  going forward: no live migration without its `.sql` committed in the same
  sitting.
- **Critical live pricing bug** — the booking budget-validation trigger
  (`tg_validate_job_budget`) was comparing the total job price against
  stale/mis-scaled numbers instead of the same bucket+distance pricing the
  quote screen used, rejecting valid bookings (e.g. a real $400 booking for
  12m³ River sand was rejected as "outside $12-$16"). Trigger now calls
  `compute_material_offer` directly — the exact same RPC the quote screen
  uses — so there is one source of truth for pricing bounds. See migration
  `0033`.
- **Realtime job/bid staleness** — driver's job page now subscribes to
  postgres_changes on the job row + bids instead of one-time fetch; no more
  needing to back out and re-enter a job to see an accepted bid / reach the
  tracking screen.
- **Google OAuth "session was not completed"** — session-exchange poll
  budget was too short (5s) for slow connections; extended to ~20s with a
  proper retry.
- **Password reset link doing nothing** — `reset-password.tsx` was calling
  `updateUser()` even when no valid recovery session existed (expired/reused
  link), silently discarding the new password. Now waits for a confirmed
  `PASSWORD_RECOVERY` session and shows an explicit expired-link state.
- **Dispute evidence showing no photos** — admin dispute investigation only
  queried `job_evidence`, which driver pickup/delivery confirmation photos
  never populate (those live on `jobs.pickup_photo_url` /
  `delivery_photo_url`). Now pulls both.

## 25/09/2026 — driver/customer redesign + drift fix

- Drift found again: 8 live-only migrations (22/08 0052–0054, four 29/08
  security fixes, 17/09 drop_admin_mfa_requirement) were recovered verbatim
  from `supabase_migrations.schema_migrations` (md5-checked) and committed.
  `0058`/`0059` are in git and live but were never recorded in
  schema_migrations.
- `0060_driver_customer_mode_backend` (applied as 20260925095048):
  `bids.eta_minutes`, `withdraw_bid()`, `job_offer_summary()`,
  `jobs.driver_arrived_pickup_at/dropoff_at` + `driver_mark_arrived()`,
  `driver_today_earnings()`, `customer_cards()`. Wrappers live in
  `src/components/redesign/rpc.ts` (types.ts not regenerated yet).

- **Admin MFA removed — password + role only** (owner's decision,
  25/09/2026). `0061_remove_admin_mfa` (applied as 20260925160846) deleted
  all enrolled TOTP factors and revoked client access to the MFA management
  RPCs (kept, not dropped — re-GRANT to restore). `require_admin_mfa()`
  stays a no-op for its 8 callers; `mfa_recovery_*` tables kept as audit
  history. Frontend `/mfa` page and admin Security tab deleted.
  **Superseded:** later migrations (0073+) added a step-up (`require_aal2`) on money
  and role actions and the `/mfa` page came back; since 0111 (23/10) a recent Google
  sign-in satisfies the step-up — see the 23/10 section below.

- `0062_offer_expiry_raise_price_nearby_trucks` (applied as
  20260925165036), owner said "do what similar apps do": driver offers
  valid 30 min (`bids.expires_at`, trigger-enforced; resend restarts),
  `raise_job_budget()` (raise-only, capped at pricing_breakdown.high),
  `nearby_available_trucks()` / `job_bidder_locations()` (~1 km-rounded,
  Online + verified drivers only, no ids).

## 30/09/2026 — full audit

- Git and live migrations matched (no drift) before this session's work.
- **CRITICAL, fixed (`0063`, applied as 20260930050611):**
  `payments_status_check` didn't allow `'released'`, but
  `release_escrow_and_complete()` sets it — so every Con Z Pay (escrow)
  completion/payout (confirm delivery, driver PIN, 72h auto-release) would
  have failed. No escrow payment had reached `paid` live yet, so nobody hit
  it. `mark_escrow_payment_paid()` now also no-ops on `'released'` and
  notifies admins if a job gets paid twice (refund the duplicate).
- `0063` also revoked client EXECUTE on cron/maintenance functions
  (`create_dispatch_wave` let anyone blast an offer to every driver), and
  restricted `driver_can_accept_for` (leaked any driver's wallet balance to
  anyone) and `evidence_distance_m`. `0064`/`0065` (20260930050820 /
  20260930050916) tightened `driver_can_accept_for`'s NULL-uid handling.
- App fixes: `activateAccount` no longer overwrites the user's edited
  name/phone on every app open; super_admin-by-email requires a confirmed
  email; escrow Pay re-checks earlier Paynow attempts before starting a new
  one and refuses completed/cancelled jobs; job page treats any paid/released
  escrow row as paid; Paynow key fragments no longer logged; MCP
  `get_wallet`/`list_my_jobs` used non-existent columns/statuses;
  `src/integrations/supabase/types.ts` regenerated from live (typecheck is
  now clean).
- Still open (owner's call): enable leaked-password protection in Supabase
  Auth settings; `pg_net` lives in the public schema; `market_rate_history`
  and `driver_public_profiles` are SECURITY DEFINER views (intentional for
  public profiles — review before changing).

## Resolved since the above list was written

- **`demand_multiplier` / diesel price conflation** — was a real code bug:
  admin.settings.tsx's "Price multiplier" field loaded its value from
  `diesel_price_per_liter` but saved via `admin_set_demand_multiplier` (a
  different setting), so setting the diesel price silently applied an 87%
  markup to every material cost. Fixed: split into two correctly-wired
  cards (Diesel price -> `admin_set_diesel_price`, recreated after being
  found missing live; Price multiplier -> `admin_set_demand_multiplier`,
  now reads its own value). Migration `0034` reset `demand_multiplier` to
  1.0 for all materials. Diesel price stays at $1.87/L (intentional, real
  rate). Any job quoted between Paynow going live and this fix (~9h window
  on 13/08) may have had an inflated material cost line.
- **Duplicate commission-rate control** — removed from `admin.settings.tsx`;
  it now lives only in `admin.revenue.tsx`. Rate stays at 7%.

## Open questions — need the owner's answer, don't act unilaterally

- Owner reported changing password from Account Settings (logged in via
  Google) "didn't apply" — the code in `profile.tsx`'s `SetPasswordCard`
  looks correct (calls `supabase.auth.updateUser` with proper error
  toasting), couldn't reproduce/diagnose from a screenshot alone. If it
  recurs, get the exact toast/error message.

## Admin screens not yet decluttered

`admin.ledger.tsx`, `admin.disputes.tsx`, `admin.audit.tsx`,
`admin.reports.tsx`, and `admin.verifications.tsx` were done 13/08/2026
(reorg only, no functional changes — see "What's been fixed recently").
Still remaining: the post-a-job flow (`jobs.new.tsx`, `customer.book.tsx`),
`chat.$jobId.tsx`.

## 07/10/2026 — function EXECUTE lockdown (applied live, files committed same sitting)

- `lockdown_function_execute_grants` (20261007064938): revoked PUBLIC/anon EXECUTE
  on every SECURITY DEFINER function in `public`. Anon keeps only
  `get_public_tracking`, `public_material_pickups`, `has_role`,
  `compute_material_offer`.
- `restrict_internal_functions_to_service_role` (20261007065034): money and
  cron functions (escrow release, commission hold/release, credit_wallet_from_payment,
  claim_super_admin, sweeps/expiries) are service_role-only.
- `restore_prior_function_revokes` (20261007071444): the blanket grant in the first
  migration briefly re-opened `wallet_available`, `recent_cancellation_strikes` and the
  MFA RPCs that 29/08, 0061 and 0063 had closed; re-closed same session.
  LESSON: never blanket-GRANT to authenticated; check earlier migrations first.
- `0071_guard_triggers_security_invoker` was live but missing from git; recovered
  verbatim from `supabase_migrations.schema_migrations`.
- Still open: complete_job (direct-pay) has no PIN/evidence requirement; leaked-password
  protection off; `pg_net` in public schema.

## 07-08/10/2026 — security hardening programme (branch `security/hardening`, local)

- Plan, phase log and owner decisions: `docs/security/CONZ-HARDENING-PLAN.md`; second audit:
  `docs/security/CONZ-SECOND-AUDIT.md`; final status: `docs/security/CONZ-FINAL-READINESS-REPORT.md`.
- Migrations `0072`–`0086` written and tested (pgTAP 380/380 on a fresh local Supabase via
  `node scripts/db-test.mjs start|test`; the full history is NOT replayable — the harness uses the 13/08
  baseline + later files).
- **Applied to production so far: ONLY `0072_financial_numeric_integrity`** (applied as `20261007231311`,
  statement md5 verified equal to the git file). `0073`–`0086` are NOT live; several require the app to be
  deployed first (see the final report's deployment order).
- `0084` commits production-only objects that were never in git (`wallet_transactions_immutable`,
  `storage_evidence_guard`, chat-media / job-proof storage policies).

## 23/10/2026 — live state check + admin protection (branch `ccr-4fab7e0d-2b8j1o`)

- **The 08/10 note above is out of date.** Read-only check 23/10: every function from `0077`–`0108` is live and
  its body hash matches git, but `schema_migrations` only records `0072`–`0076` and `0098`. Do NOT run
  `supabase db push` until the record is repaired (owner approval needed). `0109` is LIVE (applied and recorded
  23/10 as `20261022100000`, undo in `supabase/rollbacks/`). `0110` is NOT live: apply only after this branch
  (driver "Start trip" retry) is deployed — see its header.
- **`0111_admin_google_stepup_owner_lock` is LIVE** (recorded as `20261023200000`). Owner decision: no
  authenticator app. `require_aal2()` also accepts a Google sign-in from the last 12 h on an account with a Google
  identity; super admin only for rows in `super_admin_owners` (the two current owners; add one only via SQL);
  admin accounts can't gain/receive an identity with another email; owners are notified on admin sign-in and on
  every `admin_audit_log` row. Undo: `supabase/rollbacks/20261023200000_0111_rollback.sql`.
- **Supabase MCP gotcha:** `apply_migration` and `execute_sql` hang (60 s timeout, nothing applied) when the SQL
  contains `DROP`. Use `CREATE OR REPLACE TRIGGER` / `CREATE OR REPLACE FUNCTION`, split large changes into
  transactions, and verify live hashes against a local build afterwards.
- Driver "Go online" now reports failed saves (dispatch needs a fresh row in `driver_availability`; it was empty
  live and no dispatch offer had gone out since 13/10). Admin home lists open jobs that reached no driver.

## Release status — 24/10/2026 (branch `ccr-4fab7e0d-2b8j1o`, ahead of `main` and 0 behind)

Checked by read-only queries against production on 24/10 (body hashes with whitespace removed):

| Migration | Live? | Evidence |
| --- | --- | --- |
| 0077–0108 | Yes, unrecorded (except 0098) | every function body matches git |
| 0109 accept_bid expiry | Yes, recorded `20261022100000` | `accept_bid` = `475a2778…` |
| 0110 evidence stage order | Yes, recorded `20261023100000` (24/10, after the app deploy) | `record_job_evidence` = `38cb7974…` |
| 0111 admin Google step-up | Yes, recorded `20261023200000` | 6 functions + 5 triggers match the tested build |
| 0112 pickup check + route trail | Yes, recorded `20261024100000` (24/10) | 4 functions match git; 2 tables (RLS, admin read), 2 triggers, cron `prune-job-route-points`; undo in `supabase/rollbacks/` (has DROP — run it in the SQL editor) |

Tested on 24/10: typecheck, `npm test` (268), `npm run lint:security`, `npm run build`, full pgTAP
(43 files / 1061), browser checks on the local sample-data stand-in (admin dispute panel: photos with GPS,
delivery distance, chat transcript; driver Start-trip retry with a failing
first attempt, offers, tracking, admin, at 360/390 px light/dark). NOT verified: real Google sign-in against
0111, a real Android phone, Paynow, push delivery.

Safe next steps, in order: (1) owner merges `ccr-4fab7e0d-2b8j1o` into `main` (Vercel deploys);
(2) smoke-test on production (driver pickup → Start trip → delivery photo → PIN; admin money action after a
Google sign-in); (3) apply 0110 (file has no DROP; undo in `supabase/rollbacks/`; expected hash after applying
`38cb7974…`) and record it — it also stops photos overwriting the job's pickup point and delivery address,
which made the admin dispute panel's "metres from the delivery address" always read ~0; (4) apply 0112 (no DROP,
safe to apply after 0110; the app copes with it missing); (5) repair `schema_migrations` for 0077–0108 before anyone runs `supabase db push`.
Known, not blocking: some low-contrast orange text and unlabeled map pins (fixed globally on the separate
`design/site-docket` branch).

**0112 — pickup location check, "Where did you load?", route trail (owner asked 24/10, 2 km threshold).**
Flags, never blocks: the first pickup photo's GPS is compared with the supplier (or the job's pickup point);
over 2 km, no photo location, or a driver-arranged pickup with no named source → admins get a `pickup_check`
notification and an item under "Needs attention". Driver-arranged jobs ask the driver "Where did you load?"
before the pickup photo (`set_job_loaded_at`). While a job is accepted/in progress, `driver_locations` updates
are copied to `job_route_points` at most every 2 min, kept 90 days (cron `prune-job-route-points`), admin-only;
the admin dispute panel's "Pickup and route" section shows the check and a map. Customers see nothing new.
pgTAP `430_pickup_check_route_trail`; unit `pickup-check`, `admin-pickup-attention`.

**24/10/2026 — released.** PR #7 (this branch) merged to `main` and deployed; owner smoke-tested production; then
0110 and 0112 were applied (statement bodies without header comments, via `execute_sql`) and recorded. PR #8: the
site names the operator, Navysky Innovations (Private) Limited, company no. 145174A02102026, registered office
12705 Timire Park, Ruwa; contact email navyskyinnovations@gmail.com (directors' IDs deliberately not published).
The old ZIMRA TIN (sole proprietorship) was removed from Terms/Privacy; add the company's TIN when issued.
Still open: repair `schema_migrations` for 0077–0108 before any `supabase db push`.

## 26/10/2026 — release review (branch `release/integration-review`, read-only checks)

Full evidence and plan: `docs/release/RELEASE-READINESS-2026-10-26.md`. Corrections to the notes above:
- **0103 was never applied** (applied 28/10, see below). Production's `admin_set_demand_multiplier` accepts any admin with no step-up, and
  `admin_set_diesel_price` runs the 0100 body. Apply 0103 (owner approval); the settings screen already handles step-up.
- 0079: `find_next_loads_for_driver` differs from git by one token (live-only edit); the other 0079 functions match.
- The history gap is 0072–0108: 0072–0076 and 0098 are recorded under different versions than the git files. Repair
  commands are in the release doc. Still: never run `supabase db push` before the repair.
- 0117 renumbered to `20261026121000` (0116 in PR #18 uses `20261026120000`).
- Pomona Stone Quarries and Davis Granite are "verified" **locations** (public-source seeds 0050/0054), not partners.
- Quotation requests (0087/0088 backend, live, 0 rows) are reachable again only behind
  `system_settings.sourcing_requests_enabled = true` (off by default).

## 28/10/2026 — released (owner: "merge and deploy all the fixes")

Pushed to `main` as `eced140` (Vercel deployed); then applied live via `execute_sql` and recorded:
`0122` (20261027130000) admin sign-in alerts not to the signer, max once / 30 min per admin;
`0123` (20261027140000) `admin_price_accuracy()` + Settings card "How close are our estimates?";
`0124` (20261027150000) material/bucket price setters = super admin + `require_aal2()`;
`0125` (20261027160000) no INSERT/UPDATE/DELETE for anon/authenticated on system_settings, material_prices,
material_price_buckets, user_roles, small_load_settings (all writers are SECURITY DEFINER; app never writes them).
Undo scripts in `supabase/rollbacks/`. Same release: reload once on stale-build chunk errors, separate dispute lists for
customers/drivers, price-check copy ("Book this delivery" / "Request driver offers", material + delivery split only when
it adds up), driver copy no longer promises withdrawals while paused. Live checks after applying: functions/grants as
intended, public price check returns its guide range. Owner guide: `docs/security/ADMIN-GOOGLE-SIGNIN-GUIDE.md`.
Also applied 28/10: `0103` (recorded 20261012350000) diesel price + demand multiplier = super admin + `require_aal2()`
(undo: `supabase/rollbacks/20261012350000_0103_rollback.sql`). Not in this release: PR #38 (Payonify + 0120/0121).

## 28/10/2026 — shared tracking map + security sweep (branch `design/public-tracking-map`)

- Shared tracking link `/track/$token`: one map (`src/components/tracking/LiveDeliveryMap.tsx`) instead of two;
  truck ETA = car time × 1.4 (`src/lib/live-map.ts`); route re-asked only after 250 m / 3 min (also in
  `RouteMap`). Review and free-service limits: `docs/design/PUBLIC-TRACKING-MAP.md` (CARTO commercial free tier
  = 1M tiles/month from 1 Dec 2026; OSRM demo server also drives quote road distance).
- `0126_public_tracking_details` (20261028100000) — **NOT applied**: step times, heading, trail since loading,
  cancelled → `{"status":"cancelled"}`. No DROP. Deploy the app first. pgTAP 580.
- No-login server functions (`getRoute`, geocode) refuse non-Zimbabwe coordinates and are rate-limited per
  address (`src/lib/public-guard*`). Unused `src/lib/api/example.functions.ts` removed.
- Security sweep (read-only, 28/10): **0114, 0115, 0119 are on `main` but NOT live** (no trigger/constraint/policy
  changes live; live `handle_new_user` and `driver_profiles_guard_direct_write` still equal the 0115 rollback
  definitions, so 0115 applies cleanly). 0114/0115 contain DROP POLICY (SQL editor, or the MCP hangs).
  Demo edge functions `quick-responder` (spends the ORS key for anyone with the public key) and
  `smooth-handler` (hello world) are still deployed and unused by the app. Advisor: 2 search_path warnings (fixed
  by 0115), `driver_public_profiles` SECURITY DEFINER view (intentional), `pg_net` in public, leaked-password
  protection off (owner setting).

## 02/11/2026 — pricing engine v1.4 (branch `pricing/finalize-v14`, owner-approved release)

- `0127_pricing_engine_v14` (20261102100000), no DROP, writes no settings: trips = ceil(qty/20) for every size;
  >20 m³ history from completed, undisputed, road-distance-comparable jobs (≥10 jobs, ≥3 drivers, median), else the
  deterministic calculation; low (1–20 m³) = bucket min + one delivery fee (≤ recommended); non-numeric settings fall
  back (diesel $2.04, fuel 32 within 10–80, allowance 1.87 within 1–3); new `admin_set_fuel_assumptions`
  (super admin + `require_aal2` + reason + audit) and `admin_price_accuracy_completed`. Live engine before 0127:
  md5 `4b23d1de…` (= rollback file); after: `449eb457…`. Diesel stays $1.87 (owner). pgTAP 590; 360/490/550 updated
  for the intended changes. Undo: `supabase/rollbacks/20261102100000_0127_rollback.sql`.
- **Released 02/11/2026 (owner-approved):** PR #42 merged as `1427899` (Vercel deployed; new chunks verified on
  www.conz.co.zw). 0127 applied via `execute_sql` (statement bodies without comment-only lines) and recorded as
  `20261102100000`; live `compute_material_offer` md5 `0bf44570…` (= the applied body; the git file body with comments
  hashes `449eb457…`). Live checks: river sand 12 m³ / 15 km = $174 / $200 / $230; 20 m³ = 1 trip $320; 20.01 m³ =
  2 trips $340; 25 m³ $420; 30 m³ $480; anon quote via the site's public key works; anon call to
  `admin_set_fuel_assumptions` refused (401); diesel still 1.87, commission 7, no fuel/markup rows written.
  Not verified live: the Settings fuel card with a real super-admin step-up, and a driver offer on a real job.
- App: `src/lib/pricing-assumptions.ts` (same fallbacks as the engine) used by Settings and the driver fuel estimate;
  Settings card "Fuel use and long trips"; accuracy card has "Completed deliveries" / "Customer accepted".

## 03/11/2026 — 0114 + 0115 applied live (owner: "Go ahead", then "No drop but proceed")

- The Supabase MCP approval pop-up for DROP timed out three times, so both files were rewritten without DROP
  (branch `fix/0114-0115-no-drop`, commit `f8688e6`): policies are renamed and changed with `ALTER POLICY`. Same access.
  pgTAP 1259/1259 locally; both undo scripts tested locally.
- `0115` recorded `20261026110000`: sign-up gives driver/customer only (no hard-coded email); admins can't edit a
  driver's approval fields directly (use `admin_set_driver_verification`); supplier contact columns hidden
  (`admin_list_supplier_contacts()` for admins); "Users read own profile" / "Job partners read each other" for
  signed-in users only; search_path fixed on the two sourcing functions. Three duplicate profile policies remain
  (`Users can insert/update/view their own profile`, same access as kept ones): remove them in the SQL editor sometime.
- `0114` recorded `20261026100000`: truck add/change by a driver sends them back to review and withdraws pending
  offers; a job can only be given to a driver passing `is_verified_driver`; trucks readable only by their driver,
  admins, and customers whose jobs got an offer with that truck.
- Live function hashes equal the local build (whitespace-stripped md5): handle_new_user `a787bfd6…`,
  driver_profiles_guard_direct_write `6d40220f…`, admin_list_supplier_contacts `4cdf5334…`,
  tg_truck_change_needs_review `51a8a13c…`, tg_jobs_driver_must_be_verified `f4cf6f2c…`.
- Next in the permissions plan: revoke TRUNCATE and anon write grants (new migration); owner deletes demo edge functions
  `quick-responder`/`smooth-handler` and turns on leaked-password protection; repair schema_migrations 0072–0108.

## 03/11/2026 — 0138 grants + merged work (branch `security/revoke-unneeded-grants`)

- `0138_revoke_unneeded_table_grants` is **LIVE** (applied 03/11 via `execute_sql`, recorded `20261103200000`; undo in
  `supabase/rollbacks/`). anon lost INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on public tables; authenticated lost
  TRUNCATE/TRIGGER/REFERENCES; default privileges for new tables narrowed. Live check: anon_bad 0, auth_bad 0, authenticated
  INSERT kept on 38 tables, anon SELECT kept on 46.
- PR #43 (0114/0115 without DROP) is merged; both are live and recorded. Do not reapply.
- On `main` but NOT live: 0113, 0116 (PR #18, still open), 0120/0121 (PR #38), 0129–0137 (privacy 0133 matters most).
- Manual (no tool for it): delete demo edge functions `quick-responder` and `smooth-handler` (nothing in the repo uses
  them; edge logs 03/11 show only `send-push` calls; keep `send-push` and `send-sms`); `pg_net` extension still in public.
- **Plan limitation (owner decision 03/11: stay on Supabase Free, no paid services):** leaked-password protection
  (Auth > Sign In / Providers > Email > "Prevent use of leaked passwords") is, as far as we know, a Pro-plan feature, so it
  stays OFF while on Free. The advisor warning `auth_leaked_password_protection` is accepted for now. Compensating
  controls: minimum password length and Google sign-in; revisit if the plan changes.

## 04/11/2026 — privacy and notification release (owner approved: "Go ahead on all")

- Merged to `main`: #58 `4e0440d` (0133 without the `pods` join), #57 `786f7ac` (0140), #56 `305f1b5` (notifications + 0139),
  #55 `5a8e21e` (commission example), #54 `a67729c` (value proposition + repeat order).
- **LIVE, applied via `execute_sql` and recorded:** `0133` (20261103150000, comment-only lines and one trailing comment stripped),
  `0136` (20261103180000), `0139` (20261104100000), `0140` (20261104110000). Undo scripts in `supabase/rollbacks/`.
  Live checks: Jobs visibility policy = customer / assigned driver (accepted, in_progress, completed) / admin; exact functions not callable
  by clients; `archived_at` column and `notifications_user_active_idx` exist; trigger text updated.
- Production probe (DB-level, as an unselected verified driver, a selected driver, the customer and a visitor, in a transaction that was
  rolled back): unselected driver reads 0 rows by id or by status filter, masked function shows area and 2-decimal coordinates only,
  notes phone hidden, no receiver or tracking token; selected driver reads the exact address; customer reads own job; visitor 0 rows;
  `driver_job_history` runs. Not an HTTP-level test (no test tokens). Notification generation not exercised live (needs a real new job).
- One-off redaction executed (see `supabase/maintenance/`): 248 old `new_job` notification bodies now show the area only.
- Still NOT live: 0113, 0116, 0120/0121, 0129-0132, 0134, 0135, 0137. `public.pods` does not exist in production. The
  `on_auth_user_created` trigger exists live but is not in git.

## 07/11/2026 — reliability + retention (PR #71, #72 merged; retention branch `retention/trust-differentiation`)

- **LIVE and recorded in `schema_migrations`** (applied 07/11, hashes checked against the local build): `0143` (20261107100000), `0144`
  (…110000), `0145` (…120000), `0146` (…130000), `0147` (…140000). Undo scripts in `supabase/rollbacks/`. `0146`'s rollback restores the
  verbatim original `create_dispatch_wave` / `expire_stale_dispatch_offers` (md5 `0cec3ec1…` / `4508d7f8…`).
- **NOT applied anywhere but the local test stack:** `0148` structured cancellation reasons, `0149` post-delivery feedback, `0150`
  admin marketplace metrics (+ `jobs.no_show_reopened_at`, re-creates `customer_reopen_no_show_job` with one extra assignment, so its
  live md5 will change from `6a070c1e…`), `0151` dispatch notification content (re-creates `create_dispatch_wave`; undo restores
  the 0146 body `61893547…`). Apply in that order, after the app from this branch is deployed.
- **Supabase tool gotcha #2:** `execute_sql` asks the user a confirmation question (and times out after 60 s if it never reaches them) for
  statements containing `delete from`, e.g. 0145 and 0147. Run those in the Supabase SQL editor, then verify hashes and record the
  version with an `insert into supabase_migrations.schema_migrations (version, name, statements)`.
- Guard triggers that must see the CALLER's role (`current_user in ('authenticated','anon')`) have to be SECURITY INVOKER; in a
  SECURITY DEFINER function `current_user` is the owner (found and fixed in 0148).
- Live `hold_job_commission` / `release_job_commission` are the OLDER versions (md5 `959e1824…` / `28707533…`); the local stack builds
  newer ones (0091/0134). Money-path tests (820, 870) pass on both; check live before assuming a newer behaviour.
- Details: `docs/marketplace/RELIABILITY-2026-11-07.md`, `docs/marketplace/RETENTION-TRUST-2026-11-07.md`.

## 08/11/2026 — overnight improvements and offline work (PRs #74–#80, all merged to `main`, web only, no migrations)

- #74 repost cancelled/expired requests, waiting screen shows posted time and close time, prefilled repeat on the delivered
  screen, customer-home wording that stays true under dispatch assignment. #75/#76 same honesty fix in the repeat notice and the
  driver walkthrough. #77 a malformed tracking link says "not found". #78 driver location sharing resumes after leaving the page
  or a reload and warns when the customer cannot see the driver; the customer's ETA is truck time (road time x 1.4) everywhere,
  and the route request bug (timer cancelled by an effect re-run; destination arriving late) is fixed.
- #79 offline phase 0: only a real server answer signs someone out of a screen (`src/lib/auth-guard.ts`, `route-guards.ts`; admin
  screens deliberately untouched), failed profile/role reads no longer wipe roles, TanStack Router's own page reload is held back
  while offline (`stale-build.ts`), a "No signal" banner, job page "Waiting for signal", Call button works from a number saved on the phone.
- #80 "Ready offline": per-job card (address, map position, notes, other person's number; customer's delivery PIN) saved in
  localStorage for 7 days (`offline-card.ts`), shown when the job cannot load, cleared at sign-out BEFORE the sign-out request
  (`sign-out.ts`) and when the job ends; `public/sw.js` now also serves `public/offline.html` for failed page navigations.
- Research and plan: `docs/offline/OFFLINE-RESEARCH-2026-11-08.md`, `docs/superpowers/plans/2026-11-08-offline-ready-card.md`.
  Owner findings and reserved decisions: `docs/marketplace/OWNER-DECISIONS-2026-11-08.md` (seven jobs stuck 19-88 days; dispatch
  honesty; no drivers online overnight; Android background GPS needs a native release).
- NOT verified: the service worker inside the Android shell's WebView, any real phone, push delivery. Signing out with no signal does not end
  the session (the sign-in library gives up on a network error): saved data is cleared, the session fix is a follow-up.
- Owner approved the recommended answers (08/11): next slice needs the database (photo outbox with capture-time columns, late-evidence labels in
  the admin dispute panel, "delivered, waiting for confirmation"), and must leave the commission/reserve/escrow clocks (24 h no-show
  sweep, 72 h auto-release) alone and flag them.
- Gotchas: Playwright's offline switch does not stop a service worker's own requests (stop the dev server to test the fallback page);
  never branch from local `main` (it is stale): `git fetch` and branch from `origin/main`.

## 08-09/11/2026 — marketplace upgrade programme (audit + first slices)

- Brief, audit and decisions: `docs/marketplace/CONZ-MARKETPLACE-UPGRADE-AUDIT.md` (baseline matrix, commission invariants, plan),
  `CONZ-NATIONWIDE-PRICING.md` (transport-only formula, UNCALIBRATED, switch default off), `CONZ-COMPETITOR-RESEARCH.md`,
  `CONZ-COMMISSION-CREDIT-RISK-NOTE.md` (legal questions only; not legal advice).
- Product rules (owner's brief): two participants only (clients and independent drivers); pickup places are locations, not accounts; client pays
  the driver directly, ConZ never holds the fare; ConZ earns 7% of the agreed TRANSPORT fare from the driver's prepaid commission credit
  (reserve on accept, one release on cancel, one charge at verified completion; first job free); no cash-out of commission credit; wording: "commission
  credit", never "wallet/escrow/we hold". Today's commission base is still the whole accepted price including materials; the switch to
  transport-only is designed but NOT built or live (owner go required).
- **LIVE and recorded 09/11:** `0152` offer_bidder_cards + declared truck facts (20261108100000), `0153` closes the bidder exposure
  (20261108110000: customers no longer read a bidding driver's profile row/phone/email or truck row before choosing), `0154` a driver's answer
  to a dispatch request is now an offer the customer must accept (20261108120000; undo restores the 0105 body). Apps merged: PRs #82, #83, #84.
  Live hashes (whitespace-stripped): offer_bidder_cards `a75845e6…`, accept_dispatch_offer `eb2edb77…`. Live-vs-local hash for 0152's trigger differs only by
  one stripped trailing comment.
- Audit findings (see the audit doc, section 4): H1 (`held_commission_promo` client-writable) and M1 (admin direct writes to money columns) are CLOSED by 0155;
  0134 is still not live and has its own open finding M4 (promo reserve skips the ledger): do not apply it before fixing M4. M2 is CLOSED: `0113` applied live 09/11 (recorded 20261025100000; live `settle_direct_pay_job` prosrc md5 `80b4769f…` equals the committed text minus comments; undo in `supabase/rollbacks/`). M3 is CLOSED by owner decision 09/11: `0160` (20261109150000) returns a direct-job dispute refund to the DRIVER's commission credit, not the customer (live `resolve_dispute` md5 `b9fcbc8e…` = committed text; undo restores the 0093 body). Still open: M5 referral credit; the old note "complete_job has no PIN" is stale (0096 requires PIN + evidence).
- `scripts/db-concurrency-check.sh`: S8 fails since 0144 (it accepts two jobs for one driver in one transaction); run `tests.enable_launch_features()` first.
- **Also LIVE and recorded 09/11:** `0155` jobs money-column guard, admins included (20261109100000), `0156` review fixes: revived dispatch offer gets a
  fresh 30-min expiry, trucks policy limited to the accepted offer's truck, no 5+ digits in declared truck facts (20261109110000; live
  `accept_dispatch_offer` md5 `5b04701b…`), `0157` job agreement card: `job_agreements` + propose/accept/decline functions, fare copied from the
  job, no direct writes (20261109120000). Agreement card UI is in `src/components/AgreementCard.tsx`; it hides itself if the table is missing.
- `0158` (transport-only pricing engine `compute_transport_offer`, `system_settings.transport_pricing_enabled=false`, `jobs.pricing_basis`) and `0159`
  (transport quotes written only by the server, validating trigger `tg_validate_transport_job`, one early return added to `tg_validate_job_budget`; live prosrc
  md5 `e1909ee1…`; undo restores the 0108 body) are LIVE and OFF (recorded 20261109130000 / 20261109140000). The booking form has a pickup picker and
  delivery-only quote behind the switch (`src/lib/transport-quote.functions.ts`, `transport-offer-view.ts`). Turning the switch on, or changing the commission
  wording/terms, needs the owner's explicit go. Verification report:
  `docs/marketplace/CONZ-MARKETPLACE-UPGRADE-REPORT.md`.

- **Owner decisions 09/11/2026:** delivery-only pricing stays OFF for now (the wording that follows the switch is built: `src/lib/commission-copy.ts`, `useTransportPricingEnabled()`,
  and `0161` lets signed-out visitors read the one-boolean `transport_pricing_enabled()`; live 20261109160000); the $500 launch cap stays; diesel stays $2.04/L;
  dispute refunds on direct jobs go back to the driver (0160). To launch delivery-only pricing: set `system_settings.transport_pricing_enabled` to `true` (the wording on the terms, home, wallet, help, walkthrough, driver offer form and public price check already follows the switch; re-check the $500 cap first).

## 09/11/2026 — dependency and MCP endpoint security (PRs #100, #101, merged)

- `/mcp` (read-only tools behind Supabase OAuth) now runs `@lovable.dev/mcp-js` 3.4.0 / `@modelcontextprotocol/sdk` 1.32.2, which fixes six high advisories (bearer
  accepted for another service, memory exhaustion, no body/batch limit, cross-origin credential redirects). The helper routes `/.mcp/list-tools` and `/.mcp/invoke-tool/$tool`
  no longer exist (3.x). `package.json` has `"overrides": {"lightningcss": "^1.33.0"}` so a plain `npm ci` works (the new library's optional peer vs Tailwind's pin).
- The MCP issuer is derived from `VITE_SUPABASE_URL` (`src/lib/mcp/issuer.ts`). Before this, production advertised the STAGING project as its authorization server because
  `VITE_SUPABASE_PROJECT_ID` in the production build held the staging id. **Owner: set `VITE_SUPABASE_PROJECT_ID=ovwrsocjmkpiygipmrdk` in Vercel's Production environment**;
  keep staging values scoped to Preview.
- `zod` is now 4.6.x (was 3.x, high advisory) and `seroval` is patched; the only production advisory left is low (esbuild's dev server on Windows). Re-run `npm audit --omit=dev` after dependency changes.
- CI gotcha: `database-tests` can fail on a GitHub 504 while the Supabase CLI downloads an image library; re-run the failed job (`rerun_failed_jobs`) before suspecting the change.
- Check lint with its exit code (`npm run lint:security; echo $?`), not by tailing the last line.
