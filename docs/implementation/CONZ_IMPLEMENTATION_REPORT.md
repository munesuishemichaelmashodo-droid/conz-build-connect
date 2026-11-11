# ConZ implementation report for the owner (09/11/2026)

Detail and evidence: `CONZ_EXECUTION_STATUS.md`, `CONZ_BASELINE_AUDIT.md`, `CONZ_OWNER_REVIEW_REQUIRED.md`, `CONZ_DEMO_DATA_INVENTORY.md`,
`docs/release/CONZ_RELEASE_EVIDENCE.md`, `docs/payments/CONZ_PAYMENT_INTEGRATION_HANDOVER.md`, `docs/marketplace/CONZ-MARKETPLACE-UPGRADE-REPORT.md`.

## 1. What is now working
- Customers post a job, compare driver offers (price, rating, truck facts, no phone or email before choosing), accept one, and confirm an agreement card (fare, payment method and
  timing, optional deposit, windows, inclusions) that both sides must accept; any change needs the other side to confirm again and old versions are kept.
- Drivers see load, size and area, offer a price, are held to a 30-minute offer expiry, and pay 7% commission from prepaid commission credit that is reserved when a job is accepted
  and charged exactly once at completion (cancellation releases it once).
- Admins have role-gated screens; money, pricing and role actions need a recent Google sign-in; KYC documents live in private storage.
- Delivery-only (transport) pricing is built and tested but **switched off** by your decision.

## 2. What was already working and preserved
Booking, bidding, dispatch, chat, tracking, PIN delivery confirmation, offline "Ready offline" card, Paynow commission-credit top-ups, the 90-day driver re-check (enforced in the database),
first-run walkthroughs and replayable Help tours. This session changed none of these behaviours.

## 3. What was fixed or improved this session
- Dependency security: `zod` 4.6 and `seroval` patched; production dependencies now show one low advisory (PR #104).
- An admin screen claimed unset pickup points "fall back to the default Harare point". That was untrue (pricing functions hold no hidden origin); the text is corrected.
- Wallet and account-deletion screens no longer promise a refund or a withdrawal while withdrawals are paused (it was a dead end for people who wanted to delete their account).
- Audits recorded with evidence: live migration list matches git through 0161; access control (row-level security everywhere, private document buckets, 5 reviewed public functions); demo-data inventory.

## 4. What is live
`main` includes PRs #104-#106 (`6445f8e`); `https://www.conz.co.zw/` and `/terms` returned 200 after the merge and `/mcp` 401 as designed. No database change was made. Vercel deployment id was not
readable from this session.

## 5. Platform status
| Platform | Build | Real device / simulator test |
| --- | --- | --- |
| Web | Deployed, CI green (851 unit tests, full database suite) | Browser checks on the local stand-in only; not on production with real accounts |
| Android APK | Build-only: CI `build-android-apk` green | **Not tested on a real phone** |
| iOS | **Not ready**: no iOS project in the repository | None |
Notifications: web push and Android FCM code exist; **delivery not verified** on either; iOS APNs not applicable until an iOS project exists.

## 6. Security and data safety
Verified (read-only, 09/11): row-level security on every public table; `driver-docs`, `job-proof-photos`, `chat-media` private; anonymous users can run only `transport_pricing_enabled`,
`has_role`, `compute_material_offer`, `public_material_pickups`, `get_public_tracking`; bidding drivers cannot read each other's or customers' contact data before selection; job money columns
are guarded against client and admin direct writes. Remaining risk: leaked-password protection is off (Supabase plan limit); real Google sign-in against the admin step-up was never exercised;
`schema_migrations` is out of step for 0077-0108 (never run `supabase db push`).

## 7. Payment readiness
Internal commission logic is complete and tested (reserve, release, exact charge, dispute refund to the driver). Paynow top-ups work in code but there has been **no successful live top-up since
13/08** and no callback ever recorded; the reconcile setting was not configured on 24/10 and was not re-probed. Payment integration is **not** complete until Paynow confirms the merchant account,
the callback/reconcile settings are checked and you run a $1 live test. Linkwa is out of scope.

## 8. Things requiring the owner
See `CONZ_OWNER_REVIEW_REQUIRED.md` (14 items). The first ones: name the two protected demo accounts; confirm the legal company name; decide the $20 promo credit (first-job-free is still live and true, and
its 6 copy places change with that decision); confirm the deposit rule (Driver proposes); turn delivery-only pricing on when ready; real-phone and push tests; Paynow merchant and $1 live test; restore
`venmax-admin` and, when needed, `conz-staging`.

## 9. How to continue without this Claude plan
Repository `munesuishemichaelmashodo-droid/conz-build-connect`, branch `main` (work on a branch from `origin/main`, never local `main`). Read `CLAUDE.md` then `docs/implementation/CONZ_EXECUTION_STATUS.md`.
Commands: `npm ci`, `npm run typecheck`, `npm test`, `npm run lint:security; echo $?`, `npm run build`, `node scripts/db-test.mjs start` then `npm run test:db` (Docker).
**Not done and next, in order:** (1) Stage 4 competitor refresh with dated, sourced links (existing `docs/marketplace/CONZ-COMPETITOR-RESEARCH.md` is from earlier sessions) and the calibration report
only if 10 jobs and 3 drivers per segment exist (production has 11 completed jobs in total: expect "not enough data"); (2) Stage 7 UI/accessibility pass at 360/390/768/1280 in both colour schemes;
(3) deposit-proposer fix (F-AGR-1) once confirmed; (4) real-device Android test and iOS decision; (5) repair `schema_migrations` before any `db push`.
