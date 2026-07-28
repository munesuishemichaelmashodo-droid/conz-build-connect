
# Con Z Build Connect — Audit Report (read-only)

Build: `bun run build` succeeds locally, no TS/Vite errors. Production URL served by Cloudflare Worker preset via Nitro.

## 1. Bugs, unfinished flows, dead code

- **No Paynow / no payment gateway anywhere.** `rg paynow` = 0 matches. Wallet top-ups are self-credited (`request_topup` inserts as `approved` immediately with no money movement) — so top-ups are essentially "trust me". `admin_approve_topup`/`admin_reject_topup` still exist but are dead paths (nothing enters `pending`).
- **Withdrawals have no payout rail.** `admin_approve_withdrawal` only debits the wallet and inserts a notification — no Ecocash/OneMoney/Zipit/bank API is called. Manual off-platform payout is implied but not documented in the UI.
- **Two `raise_dispute` overloads coexist** (enum-arg and text-arg). PostgREST resolves by arg type; both remain callable and can drift.
- **`expire_stale_open_jobs` still present** in DB despite the "remove auto-expiry" change; if any cron ever calls it, jobs will silently cancel. Same for `expire_stale_dispatch_offers` / `expire_all_stale_dispatch_offers` — no scheduler is wired (no `pg_cron`, no `/api/public/*` cron route). Stale dispatch offers therefore sit `pending` until a driver hits `accept_dispatch_offer`, which re-checks `expires_at`. Next-wave dispatch never fires automatically.
- **`prune_stale_driver_locations`** exists but is never scheduled — `driver_locations` grows unbounded.
- **`first_job_free_claims` identity-key logic** relies on phone/email being present and stable; users who change phone before first job can double-claim. Low-risk but noted.
- **`AddressPicker` search** uses Nominatim direct from browser — no key, subject to 1 req/sec throttling and CORS/UA blocks; silent empty results still possible.
- **`RouteMap`/`getRoute`** calls OSRM public demo server (`router.project-osrm.org`) — no SLA, rate-limited, occasional 5xx. Fallback is straight-line only.
- **Auth debug panel (`authDebug`) in `src/routes/auth.tsx`** leaks Supabase URL and error internals into user-facing UI — useful for debugging, noise/leak in production.
- **`useEffect` deps disabled** in auth.tsx (`// eslint-disable-next-line react-hooks/exhaustive-deps`) — `goPostAuth` closure can be stale.
- No `TODO`/`FIXME` markers found in `src/`.
- No `try` around `supabase.auth.signInWithOAuth` popup cancellation in `oauth-callback.tsx` (not read in this audit — verify).

## 2. Security

- **Supabase linter: 85 findings.**
  - 1 ERROR: a `SECURITY DEFINER` **view** exists (bypasses RLS of caller). Needs identification and conversion to `security_invoker=on` unless intentional.
  - 82 WARN: `SECURITY DEFINER` functions callable by `anon` and/or `authenticated`. Most are business RPCs (accept_bid, complete_job, admin_*). The internal callback triggers (`tg_*`, `handle_new_user`) and admin-only functions (`admin_grant_role`, `admin_revoke_role`, `admin_set_commission`, `admin_set_diesel_price`, `claim_super_admin`, `log_admin_action`) should have `EXECUTE` revoked from `anon`/`authenticated` and granted only where needed. Right now any signed-in user can invoke `log_admin_action` and `claim_super_admin` (the latter is guarded by "if any super_admin exists, reject" — currently one exists, so safe, but a race remains if that row is ever deleted).
  - 1 WARN: **`job-proof-photos` bucket is public and listable** — anyone can enumerate every proof photo across all jobs. Should be private with signed URLs, or scoped SELECT policy.
  - 1 WARN: **Leaked-password protection (HIBP) disabled** in Auth settings.
- **`admin_credit_wallet`** accepts arbitrary `_amount` including negative; audit trail is written but no rate limit / dual-control.
- **`request_topup`** self-credits without proof; no per-day cap, no anti-fraud. Users can inflate balance instantly.
- **`raise_dispute` (text overload)** returns the existing open dispute on duplicate — but does not check if the requester is `raised_by` (any participant reusing it gets someone else's dispute row back). Verify.
- **`profiles` RLS**: full policies not inspected here; earlier work claimed role writes are locked to super_admin via `user_roles` table (correct pattern). Confirm no policy on `profiles` allows self-update of a `role`-adjacent field.
- **Client `.env`** exposes `VITE_SUPABASE_URL` + publishable key — fine by design. No secret leaks in `src/`.
- **`SUPABASE_SERVICE_ROLE_KEY`** correctly gated behind `client.server.ts` Proxy; grep confirms no client-graph import.
- **Zod validation** exists on booking (`booking.functions.ts`) but many other client mutations (bid submission, profile edits, dispute reason) go straight to `supabase.from(...).insert/update` with no server-side length caps beyond DB column types.
- **CSP / security headers**: none configured (`vercel.json` / no `_headers` for CF Worker).

## 3. Production-ready gaps

- **Payments (Paynow):** not started. No Paynow SDK, no init/redirect, no IPN webhook route under `/api/public/*`, no `payments` table, no `payment_intent` link on top-ups or job payouts. This is the single biggest missing production piece for a Zimbabwe marketplace.
- **Notifications:** in-app only (`notifications` table + `NotificationsBell`). No push (web push / FCM), no SMS (Twilio/Africa's Talking), no email (Resend). Drivers will miss 10-second dispatch waves if the tab is closed.
- **Ratings:** bidirectional (`ratings` + `customer_ratings`) exist; aggregate trigger updates `driver_profiles.rating_avg`. **Missing:** public driver profile page, review moderation, ability to flag a rating, filtering out ratings from cancelled/disputed jobs.
- **GPS/tracking:** works via `driver_locations` + `RouteMap` (OSRM). **Gaps:** no server-side pruning schedule, no geofence for "arrived at pickup / delivery", no offline queue for driver location writes, OSRM public endpoint not SLA-backed.
- **Dispatch loop:** first wave fires via `trigger_initial_dispatch`; **subsequent waves require a cron** that calls `expire_all_stale_dispatch_offers`. No cron exists → after wave 1 expires with no acceptance, the job sits `open` with 0 pending offers forever.
- **Driver KYC:** doc uploads go to `driver-docs` (private bucket ✅) but admin verification UI presumably signs URLs — verify link expiry.
- **App store readiness:** no native wrapper (Capacitor/PWA-only), no privacy manifest, no store screenshots pipeline. PWA manifest exists.
- **Observability:** no error reporting (Sentry etc.). `error-capture.ts` and `lovable-error-reporting.ts` present — extent unverified in this pass.
- **Rate limiting:** none at app layer or DB layer for RPCs (`request_topup`, `raise_dispute`, `set_withdrawal_pin` — the last has lockout after 5 wrong PINs, good).
- **Terms/Privacy:** present at `/terms` and `/privacy` with `terms_accepted_at` capture.

## 4. Currently broken in production

- Build passes and no runtime crash reproduced in this pass. Preview URL responds.
- **Functional break in production behavior (not a crash):**
  - **Dispatch stalls after wave 1** (no cron) — customers see "Matching…" with count > 0 but no offers land after the first 10s wave.
  - **`job-proof-photos` bucket public** — data-leak class issue live now.
  - **Wallet top-ups credit without payment** — economic risk live now.
- No console errors captured this turn (no logs snapshot available).

## Suggested next steps (not executed)

1. Integrate Paynow (web checkout + IPN webhook at `src/routes/api/public/paynow/webhook.ts`) and gate `request_topup` behind a verified payment_intent.
2. Add a cron (`pg_cron` → `/api/public/cron/expire-dispatch`) firing every 5–10s to keep waves rolling and prune driver_locations hourly.
3. Lock down the linter findings: `security_invoker=on` on the flagged view; `REVOKE EXECUTE ... FROM anon, authenticated` on admin-only DEFINER functions; make `job-proof-photos` private + signed URLs; enable HIBP.
4. Remove the dead `expire_stale_open_jobs` function or wire it intentionally.
5. Consolidate the two `raise_dispute` overloads.
6. Add web-push (or at minimum SMS via Africa's Talking) for driver dispatch offers.
7. Strip the auth debug panel from production builds (env-gate it).

_Nothing was modified. Approve any subset above and I'll implement._
