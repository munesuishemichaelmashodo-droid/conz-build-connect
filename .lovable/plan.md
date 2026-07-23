
# Con Z — Feature Status Audit

Legend: ✅ Complete · 🟡 Partial · 🔴 Not started

## 1. Backend security review — 🟡 Partial
- RLS: Enabled on all 24 public tables (each has policies per the tables index). Sensitive writes are routed through `SECURITY DEFINER` RPCs (`accept_bid`, `complete_job`, `request_topup`, `request_withdrawal`, `admin_*`, `raise_dispute`, `accept_dispatch_offer`) with `has_role`/`auth.uid()` checks.
- Server functions: `requireSupabaseAuth` middleware exists (`src/integrations/supabase/auth-middleware.ts`) but almost no `createServerFn` uses it — most privileged work goes through Postgres RPCs, which is fine but means there's no server-side rate limiting.
- Gaps: no automated `security--run_security_scan` has been recorded this session; MCP OAuth routes under `src/routes/[.mcp]` and `[.well-known]` are public by design but haven't been audited here. Recommend running the scanner before store submission.

## 2. Admin panel access lockdown — ✅ Complete
- `src/routes/_authenticated/admin.tsx` `beforeLoad` fetches `user_roles` and redirects to `/home` unless the user has `admin` or `super_admin`. Individual super-admin-only tabs (Revenue, Audit) hidden via `is("super_admin")`. Server-side RPCs also enforce `has_role(...,'admin'|'super_admin')`, so client bypass wouldn't grant privileges.

## 3. Rating system — 🟡 Partial (works, but only surfaced on job detail)
- Submission: `src/routes/_authenticated/jobs.$id.tsx` writes to `ratings` (customer → driver) and `customer_ratings` (driver → customer). `tg_rating_aggregate` trigger updates `driver_profiles.rating_avg`/`rating_count`.
- Display: Driver aggregate shown on bid cards (`jobs.$id.tsx` L273–274). No dedicated driver profile page listing reviews; customer ratings are stored but never displayed anywhere in the UI.

## 4. Terms & Conditions — 🔴 Not started
- No `/terms`, `/privacy`, or acceptance checkbox in `src/routes/auth.tsx`. No `terms_accepted_at` column on `profiles`. Required before store submission.

## 5. Driver verification signup — ✅ Complete
- `src/routes/_authenticated/become-driver.tsx` is the 5-step slideshow (identity → selfie → licence → truck → nationality) with progress bar, camera+gallery uploads to `driver-docs` bucket, and a "Pending verification — usually within 24 hours" confirmation screen. Admin review UI at `admin.verifications.tsx`. Bidding + dispatch acceptance are RLS/RPC-gated on `verification_status = 'verified'`.

## 6. Dispute system — 🟡 Partial
- ✅ Types selector, `raise_dispute` RPC, admin resolve queue (`admin.disputes.tsx`), `resolve_dispute` RPC with `strike_issued` outcome that increments `profiles.cancellation_strikes` and applies 7-day restriction after 3 strikes.
- ✅ 48-hour review clock: `raise_dispute` sets `review_due_at = now() + 48h`.
- 🟡 Evidence auto-pull: dispute is linked by `job_id` so admin can view `pickup_photo_url`/`delivery_photo_url` via the job, but there's no explicit evidence panel that surfaces GPS trail (`driver_locations`) or photos inline in the dispute detail view — admin has to navigate manually.

## 7. Notification system — ✅ Complete
- `notifications` table + triggers `tg_notify_bid_submitted`, `tg_notify_bid_status`, `tg_notify_job_status` cover bid submitted/accepted, tracking started, job completed, top-up decisions, withdrawal decisions, job expired. `NotificationsBell.tsx` renders them with Realtime.

## 8. Wallet top-ups (no admin approval) — ✅ Complete
- `request_topup` RPC self-credits: inserts request with `status='approved'`, immediately updates `wallets.balance`, writes `wallet_transactions` row, and notifies. Wired from `wallet.tsx`. Admin approve/reject RPCs still exist for legacy/manual cases but the user flow no longer requires them.

## 9. Help & Report in SidePanel — ✅ Complete
- `src/routes/_authenticated/help.tsx` and `report.tsx` exist and are linked from `SidePanel.tsx`. `reports` table has policies.

## 10. Customer ↔ Driver Mode switch — ✅ Complete
- Consolidated into SidePanel "View As". Customers without driver role see "Become a driver" CTA linking to `/become-driver`; verified drivers get a toggle between customer/driver views (`src/lib/view-mode.tsx`).

## 11. First-job-free bonus — ✅ Complete
- `driver_profiles.first_job_free_used` flag + `first_job_free_claims` identity-keyed table prevent multi-account abuse. `complete_job` RPC charges $0 commission on first eligible completion and logs a wallet transaction; `driver_can_accept` bypasses balance requirement while free.

## 12. App-store publishing readiness — 🔴 Not started
- No `capacitor.config.ts`, no `@capacitor/*` deps in `package.json`, no `android/` or `ios/` folders. `public/manifest.webmanifest` exists (PWA) but no native shell, no store-format icons/splash, no bundle IDs. Everything for Capacitor packaging still to do.

## Recommended next actions (in order)
1. Add Terms & Privacy pages + signup checkbox + `terms_accepted_at` column.
2. Add a driver public profile with review list (surface `ratings` and `customer_ratings`).
3. Enrich dispute detail view with inline photos + last-known GPS points.
4. Run `security--run_security_scan` and address findings.
5. Add Capacitor (`@capacitor/core`, `@capacitor/android`, `@capacitor/ios`), configure app icons/splash, set bundle IDs, and produce signed builds.

No code changes were made — this is a read-only status report.
