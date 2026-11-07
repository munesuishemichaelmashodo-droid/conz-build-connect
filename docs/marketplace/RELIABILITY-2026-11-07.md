# Marketplace reliability mission: implementation record (07/11/2026)

Branch `marketplace/dispatch-reliability` (from PR #71's head `fc9ec3e`; PR #71 untouched). Nothing committed, pushed, merged,
deployed or applied to a hosted database. Migrations 0146/0147 exist only in git files and the local test stack.

## Dispatch reliability (capabilities A, F)
Evidence (production, read-only): 94 offers, 74 expired, 0 accepted or declined; 5 verified drivers, 3 push subscriptions, 0 fresh availability rows.
Root causes confirmed in code and catalog:
1. Dispatch offers created no notification, so no push ever reached a driver outside the open app.
2. The offer modal was mounted only on the driver home screen.
3. A single 10 s window for everyone.
4. Expiry wrote `responded_at`, so "responded" counted expired offers.
5. No evidence an offer was ever seen.
6. Supply: availability rows stale, few push subscriptions (not a code defect; needs drivers to go online and allow notifications).

**0146_dispatch_push_windows** (no money, wallet, commission or escrow function touched; undo in `supabase/rollbacks/`):
- window 60 s when the driver's location refreshed < 2 min ago, otherwise 5 min (inside the existing 15 min freshness rule). Both are proposals, set in one SQL expression.
- one `dispatch_offer` notification per offered driver, reusing the existing notifications → `send-push` trigger and `/jobs/<id>` deep link; body has quantity only, no address or coordinates.
- `viewed_at` + `mark_dispatch_offer_viewed()` (own offer only); `expire_stale_dispatch_offers` no longer sets `responded_at`;
  `admin_dispatch_summary(days)` = offers / viewed / accepted / declined / expired / median response seconds (admin only).
- "delivered" is deliberately not recorded: push delivery cannot be proven from the database.
App: offer modal mounted for drivers on every signed-in screen; countdown follows the server window; notification tag per job
(`public/sw.js`) so the new-job push and the offer push replace each other. Existing accept/decline/expiry checks unchanged.

## No-show recovery (capability G)
**0147_customer_reopen_no_show**: `customer_reopen_no_show_job(job)`. The 24 h sweep still cancels (strike, commission release unchanged).
The customer may then reopen: customer only, direct-pay only, sweep reason only, within 7 days, driver never arrived, no pickup photo,
no dispute. Clears driver/price/code, 24 h window, no-show driver excluded, dispatch wave starts. Loaded or in-progress jobs are never reopened.
App: "Reopen my request" on the cancelled job screen. No automatic reopening (customer keeps the choice).

## Audit status of the other capabilities
- B quotation comparison: Best match (PR #71) unchanged: explainable, never auto-picks cheapest, customer chooses.
- C reputation: calculable now from existing data: jobs_completed, rating, driver cancellation_events, disputes. On-time rate only for dated jobs. No new indicator added.
- D accountability: statuses/evidence/notifications exist; no new work this batch.
- E repeat bookings: existing Book again / preferred driver kept.
- F availability truthfulness: driver-side indicator (`driverReach`) is honest. The customer-facing "Online" means app-open presence, not push reachability. NOT changed; decision needed.

## Tests
tsc clean; vitest 648 passed (9 skipped, pre-existing); lint:security clean; build + smoke passed; full pgTAP 77 files / 1,633 tests PASS
(new: 800_dispatch_push_windows 15, 810_no_show_reopen 12, 820_no_show_commission_integrity 12). Not verified: real push delivery, real Android device, production data.

## Decisions needed
1. Approve windows 60 s / 5 min (or change).
2. Approve applying 0146/0147 later (after PR #71's 0143-0145), app deploy first.
3. Customer-facing "Online" wording/definition.

## Final verification (focused review)
1. **0146 rollback.** Live (read-only, 07/11): `expire_stale_dispatch_offers` md5 `4508d7f8…` = the 13/08 baseline body (and the 06/07 original); `create_dispatch_wave` md5 `0cec3ec1…` = 0089. The first rollback was a reconstruction (md5 `91374044…`, wrong). Replaced with verbatim copies; applied locally, both hashes equal the live ones. 0146's own `expire_stale_dispatch_offers` is now the original with only the `responded_at` removal.
2. **Deployment order.** Live has none of 0143-0145 (no trigger/function). 0146 and 0147 need none of them (columns and the sweep's wording exist live; 0147 reads the same reason text as live and 0143). 0143-0145 need nothing from 0146/0147. App-side: the offer modal reads existing `offered_at`; `mark_dispatch_offer_viewed` failures are ignored; the Reopen button errors with a toast if 0147 is missing; PR #71's driver-release copy is only true once 0145 is live. Sequence: PR #71 migrations 0143-0145 → 0147 → app deploy (this branch includes PR #71's app code) → 0146 (old modal would show a 5-minute window as "300 seconds" / "10 seconds"). 0146 is the only step that must come after the app. Latest recorded live version 20261106100000, below all of these.
3. **0147 financial integrity.** Defect found and fixed: the "sweep only" check relied on the reason text, which a customer could type into a manual cancel. Now also requires `cancelled_by is null` (the sweep never sets it, `cancel_job` always does; 10 of 10 live sweep cancellations have it null). Test 820 proves sweep → reopen → next driver → cancel never releases twice, reserves twice or touches another driver's reserve, run on the local build and again with production's `hold_job_commission`/`release_job_commission` bodies (md5 `959e1824…` / `28707533…`; the local stack carries newer 0091/0134 versions).

## Closeout (07/11/2026)
- **PR:** #72 "Improve dispatch reliability and customer no-show recovery", stacked on PR #71 (base `reliability/booking-lifecycle`, so the diff is only the new work; retarget to `main` after #71 merges). Not merged.
- **Commits:** PR #71's: `a9422a6`, `6d45f57`, `317fe24`, `2358ff2`, `fc9ec3e`. New: `8a786a0` (0146), `0acca12` (0147). The rollback correction and the spoof fix were made before those two commits, so they are inside them; no extra commits were needed. The documentation commit that adds this section follows.
- **GitHub Actions** (manual dispatch on `0acca12`; the workflows only auto-run for PRs into `main`/`ccr-*`):
  Verify build run 230 — typecheck, security lint, unit tests, build + smoke test: success; database tests (full pgTAP) and Paynow callback tests: success.
  Android debug APK run 15: success (proves the project compiles into an APK, **not** real-device behaviour).
- **Unchanged and verified:** 0146 rollback = authoritative original functions; 0147 rejects spoofed no-show reasons (`cancelled_by` must be null); commission hold/release functions are not modified; all migrations remain unapplied to hosted databases.
- **Deployment order:** PR #71 migrations 0143-0145 → 0147 → compatible app deploy → 0146.
- **Outstanding:** owner decisions (window values, customer-facing "Online"); real-device and real push testing; supply of drivers/push subscriptions; PR #71 must merge first.

## Production status (07/11/2026, after the closeout above)
PR #71 was merged to `main` as `9feee08` (Vercel deployed its app code), and #72 was retargeted to `main`. With owner approval the migrations were then applied to production and recorded in `schema_migrations`; live function hashes were checked against the local build:
- `0143` (20261107100000) and `0144` (20261107110000): applied with `execute_sql`.
- `0145` (20261107120000): applied by the owner in the SQL editor, because the Supabase tool's confirmation prompt (statements containing `delete from`) did not reach the owner and timed out. `cancel_job` `758fb10c…`, `reopen_job_after_driver_cancel` `319cbab6…`.
- `0147` (20261107140000): applied by the owner in the SQL editor for the same reason. `customer_reopen_no_show_job` `6a070c1e…`.
- `0146` is **not applied yet**: it goes last, after this PR's app is deployed (otherwise the deployed popup would show a 5-minute window as "300 seconds").
- Commission functions unchanged: `hold_job_commission` `959e1824…`, `release_job_commission` `28707533…`.
None of this was exercised on a real job in production.
