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

**Known issue — git/DB drift:** Multiple parallel sessions (this repo gets
worked on from both a chat interface with computer-use and from Claude Code
sessions, sometimes concurrently) have applied migrations directly to the
live Supabase project without ever committing the corresponding `.sql` file.
Confirmed live-only migrations not in git as of 13/08/2026:
`drop_legacy_admin_set_material_price_text_overload`,
`restrict_admin_from_settings_and_topups`. **Before starting any DB work,
compare the live migration list against `supabase/migrations/` and
reconcile any live-only ones into committed files** so this doesn't keep
compounding. If you have Supabase MCP/CLI access, list applied migrations
and diff against the repo first.

## What's been fixed recently (13/08/2026, today)

- **Admin role restrictions** — super_admin vs admin two-tier access on
  revenue data (RLS + dashboard scoping).
- **Withdrawal PIN bug** — `set_withdrawal_pin` RPC no-op'd for users
  without a `driver_profiles` row; fixed via upsert.
- **UI decluttering pass** (reorg only, no functional changes) —
  `jobs.$id.tsx`, `wallet.tsx`, `RoleDashboard.tsx`, `profile.tsx`,
  `admin.settings.tsx`, `admin.revenue.tsx` all regrouped for clarity.
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

## Open questions — need the owner's answer, don't act unilaterally

- **`material_prices.demand_multiplier` is `1.87` for every enforced
  material** (except 'custom' at 1.0) — suspiciously exactly matches the
  diesel price per liter, strongly suggesting someone typed the diesel price
  into the admin Settings "Price multiplier" field by mistake (that field's
  own UI label says it should be ~1.00–1.08). This is currently inflating
  every material cost quote by ~87%. **Asked the owner twice, no answer
  yet** — don't reset this without explicit confirmation, it's a live
  pricing/business number.
- **Commission rate is editable from both `admin.settings.tsx` and
  `admin.revenue.tsx`** (duplicate control) — asked owner whether to
  consolidate, no answer yet.
- **Customer "Call support" button on `help.tsx`** needs a real phone
  number from the owner — not urgent, owner said they can wait.
- Owner reported changing password from Account Settings (logged in via
  Google) "didn't apply" — the code in `profile.tsx`'s `SetPasswordCard`
  looks correct (calls `supabase.auth.updateUser` with proper error
  toasting), couldn't reproduce/diagnose from a screenshot alone. If it
  recurs, get the exact toast/error message.

## Admin screens not yet decluttered

`admin.ledger.tsx` (646 lines, largest remaining), `admin.disputes.tsx`,
`admin.audit.tsx`, `admin.reports.tsx`, `admin.verifications.tsx`, the
post-a-job flow (`jobs.new.tsx`, `customer.book.tsx`), `chat.$jobId.tsx`.
