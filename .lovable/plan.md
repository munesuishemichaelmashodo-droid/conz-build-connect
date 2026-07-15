# Con Z — Audit & Improvement Plan

Based on the current state of the app (auth, wallet, dispatch, tracking, ratings, admin), here are the weaknesses I see and the systems worth adding. Pick which ones to build — I'd recommend tackling them in the order below.

## 1. Reliability & Stability weaknesses (fix first)

- **Job expiry runs in the browser.** `useExpireStaleJobs` polls every 3s only while a user has the app open. If nobody is online, stale jobs never expire. → Move to a `pg_cron` job hitting `/api/public/hooks/expire-jobs` every 5s server-side.
- **Dispatch waves depend on client accept.** If all offered drivers are offline, no next wave fires. → Add a server-side "wave scheduler" cron that calls `expire_stale_dispatch_offers` for every open job.
- **Google Maps markers use deprecated `Marker`.** Warning in console; will break in a future SDK release. → Migrate to `AdvancedMarkerElement` with a fallback.
- **No offline / weak-signal handling.** Drivers on rural Zim networks lose GPS pings silently. → Queue location updates in `IndexedDB` and flush on reconnect; show a "reconnecting" banner.
- **Realtime channels not always cleaned up.** Some `useEffect` returns don't unsubscribe → memory leaks after long sessions.

## 2. Security & Trust gaps

- **Photo verification is self-uploaded, never re-checked.** A driver verified once stays verified forever. → Add periodic re-verification (every 90 days) and admin "revoke verification" action.
- **No device / session limit.** A user can sign in on 5 devices and multi-claim free jobs across identities. → Track `auth_sessions` with device fingerprint; cap active sessions to 2 and surface them in Profile ("Sign out other devices").
- **Withdrawal PIN, but no 2FA for login.** → Add optional email OTP or TOTP for high-value accounts (drivers with >$100 balance, all admins).
- **No rate limiting on bid submissions or job posts.** A malicious user can spam. → Add a `rate_limits` table + trigger (e.g. 10 bids/min, 5 jobs/hour).
- **Admin actions aren't fully audited.** Wallet credits log, but role grants, verifications, and dispute rulings don't. → Extend `wallet_audit_log` into a generic `admin_audit_log`.

## 3. UX friction to remove

- **No job history / receipts.** Customers can't see past deliveries or download an invoice. → Add `/history` route + PDF receipt via server function.
- **No cancellation policy UI.** Currently a job can be cancelled with no consequence. → Add cancellation reason + late-cancel fee (e.g. $2 if cancelled after driver accepts).
- **Bids show driver info but no distance/ETA.** → Compute distance from `driver_locations` to job pickup and show "8 km · ~14 min".
- **Chat has no read receipts, no image support surfaced.** → Add `read_at` column + inline image preview using the existing `chat-media` bucket.
- **Notifications bell has no filtering or "mark all read".**
- **No dark/light auto-follow-system option** (only manual toggle).
- **AddressPicker has no "recent addresses" or "saved places" (Home/Work).** Big win for repeat customers.

## 4. New systems worth adding

- **Referral program.** Each user gets a code; referrer earns $2 wallet credit when referee completes first paid job. Table `referrals(referrer_id, referee_id, status, reward_amount)`.
- **Promo codes & seasonal discounts** (super-admin managed) — `promo_codes` table + validation at booking.
- **Driver earnings dashboard** — weekly/monthly graphs, tax export CSV, average $/km. Drivers ask for this constantly on similar apps.
- **Customer favorites** — mark a driver as favorite, get notified when they're online, optional "request this driver" mode.
- **Scheduled/future bookings** — customer books for tomorrow 9 AM; dispatch wave fires at T-15min.
- **Multi-stop deliveries** — one job, multiple drop-off points, price scales with legs.
- **In-app support / help center** — FAQ + "Contact support" ticket flow tied to `disputes` table.
- **Push notifications (PWA)** — currently in-app only. Add web-push via service worker so drivers get pinged when the app is backgrounded (critical for the 10-second dispatch to actually work).
- **SMS fallback for OTP / job alerts** — Zimbabwe reality: many drivers won't have push. Twilio or a local SMS gateway.

## 5. Data & Analytics

- **No aggregated metrics for super admin beyond revenue.** Add: jobs/day, acceptance rate, avg dispatch wave count, top routes, cancellation rate, driver churn.
- **No cohort tracking.** Which signup week drives the most completed jobs?
- **No AI pricing feedback loop.** `compute_material_offer` uses static multipliers. → Log actual accepted prices and adjust `demand_multiplier` weekly via cron.

## 6. Sustainability / cost

- **`driver_locations` table will explode.** Every 5s ping × 100 drivers × 24h = 1.7M rows/day. → Add a `pg_cron` job to prune locations older than 24h; keep a daily-aggregated `location_history` for analytics only.
- **Realtime subscriptions billed per concurrent connection.** Consolidate: one channel per user, not one per feature.
- **Image storage grows unbounded.** Add lifecycle: verification docs archived to cold storage after 1 year; chat media auto-deleted after 90 days.

## 7. Compliance & Legal (needed before public launch)

- Terms of Service, Privacy Policy, Refund Policy pages (static routes).
- Cookie/consent banner (EU users if any).
- Data export & account deletion (`/settings/data`) — GDPR & good practice.
- Age gate on signup (18+ for drivers).

## Recommended first batch (2–3 days of work)

If you want a concrete "next sprint", I'd pick these 6 — biggest impact, unblocks the rest:

1. **Server-side job & dispatch expiry** (pg_cron) — fixes the "nobody online" hole.
2. **PWA push notifications** — makes the 10-second dispatch actually reach drivers.
3. **Location data pruning cron** — stops the runaway table.
4. **Job history + PDF receipts** — most-requested customer feature.
5. **Distance/ETA on bid cards** — instant UX upgrade.
6. **Admin audit log** — needed the moment you have >1 admin.

---

Tell me which of these you want to tackle (all of section 1, the recommended batch, or a custom pick) and I'll turn it into a concrete build plan with migrations and file changes.
