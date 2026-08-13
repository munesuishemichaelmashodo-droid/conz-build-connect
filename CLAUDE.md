# Con Z Connect — project context for Claude Code

Construction logistics marketplace for Zimbabwe (river sand, stones, gravel,
etc. delivered by tipper truck). Customers post jobs, drivers bid, in-app
chat + live GPS tracking + escrow or direct pay. Owner: Ngaatendwe Tembo
(a.k.a. Ngaatendwe Webster / Webster Ngaatendwe in test data), based in
Zimbabwe.

## Stack

- Frontend: TanStack Start (React), deployed on **Vercel** —
  conz-build-connect.vercel.app
- Backend: **Supabase** (Postgres + Auth + Storage + RLS), project ref
  `ovwrsocjmkpiygipmrdk`
- Repo: `munesuishemichaelmashodo-droid/conz-build-connect`, branch `main`
  (Vercel auto-deploys on push to `main`)
- Payments: Paynow (Zimbabwe) — went **live** 13/08/2026 after ZIMRA tax
  clearance

## Commands

- `npm run build` — production build (also generates `.vercel/output`)
- `npx tsc --noEmit` — typecheck; run this AND build before every commit
- `npm run lint` / `npm run format`
- No test suite exists yet.

## Migration workflow (important)

Migrations live in `supabase/migrations/`, named
`YYYYMMDDHHMMSS_NNNN_description.sql` where NNNN is a sequential 4-digit
counter (currently up to 0033) kept **on top of** the raw timestamp-named
files from early development. Always:

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

(none currently open)
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
