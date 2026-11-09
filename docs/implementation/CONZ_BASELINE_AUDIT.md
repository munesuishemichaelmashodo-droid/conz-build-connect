# ConZ baseline audit (Stage 0, 09/11/2026)

Read-only. Evidence classes: **V** verified this session, **C** from committed docs/code only, **U** unverified.
Fuller matrix and invariants: `docs/marketplace/CONZ-MARKETPLACE-UPGRADE-AUDIT.md` (still current for sections not listed here).

## 1. Repository and database state
- `main` = `eb363a5`. Typecheck, 851 unit tests, security lint, build and pgTAP all green in CI on the last merge (V, CI run on PR #104).
- Live `schema_migrations` (V, `list_migrations`) contains every migration through `20261109160000` (0161). The 0077-0108 history gap in CLAUDE.md is
  unchanged: those are live but recorded under other versions or not at all. **Never run `supabase db push`.**
- **0134 (promo credit) is not live** (V: absent from the live list). Its open finding M4 (promo reserve skips the ledger) must be fixed before any apply.
- Drift check: live list vs `supabase/migrations/` shows no live-only entries after 0161 (V).

## 2. Product-model compliance (spec section "Product model")
| Rule | State | Evidence |
| --- | --- | --- |
| Two roles only | Customer/Driver in app; legacy supplier rows preserved as locations | C (0050/0054 seeds, 0115) |
| Customer pays driver directly | Direct pay is default; escrow switch `escrow_enabled` exists, default false | V code `launch-switches.ts` |
| Commission 7% of fare | Today the base is the whole accepted price incl. materials. Transport-only base is built (0158/0159) but switched OFF by owner decision | C |
| Reserve on accept / one release / settle exact amount | `hold_job_commission`, `release_job_commission`, `settle_direct_pay_job` (0113 live) | C + live hash in CLAUDE.md |
| Commission dispute refund to driver | 0160 live | C |
| One-time $20 promo credit | Not live. Old first-job-free logic and 0134 remain unreconciled | V (not in live list) |
| Withdrawals disabled | `withdrawals_enabled` default false; withdrawal code paths and copy still exist | C |

## 3. Obsolete or contradictory copy found (grep, `src/`, non-admin)
- Escrow wording behind a switch: `launch-switches.ts` trust pill "Escrow protected with Con Z Pay", `FeedJobCard.tsx` escrow badge, `paynow.functions.ts`/`paymentErrors.ts`
  escrow paths. Only shown when the switch is on; the spec puts customer fare collection/escrow out of V1. Stage 7.
- Withdrawal copy: `withdrawalStatus.ts`, `account-deletion.ts` ("withdraw the money in your wallet"), `LedgerCharts` label. Account-deletion text should say commission
  credit is not withdrawable. Stage 7.
- "90-day" verification: **supported by the backend (V, read-only live query 09/11).** `bids` insert policy and 7 public functions reference `reverify_due_at`
  (0023); 5 verified drivers, 0 overdue. The copy in `driver-onboarding.ts` / `DriverHome.tsx` is accurate; no change. Not a "blanket" block: it applies only
  when a driver's own re-check date has passed.
- "Live tracking" appears in internal comments and the walkthrough; to be checked against what actually updates (offline/fresh-location rules exist). Stage 7.
- **Correction (Stage 1):** "first completed job has no commission" IS present in 6 places (`OnboardingWalkthrough.tsx`, `terms.tsx` s.83, `jobs.$id.tsx`, `wallet.tsx` x2,
  `index.tsx`). It is **true today**: live `hold_job_commission` and `settle_direct_pay_job` still apply `first_job_free_used`, and no promo logic is live (V, read-only
  live query 09/11). Removing it before the owner-gated $20 promo change would make the copy false, so it stays until the promo migration is approved; then all 6 places
  change together. The earlier "grep clean" line in this audit was wrong.

## 4. Legal identity
Code and legal pages use **"Navysky Innovations (Private) Limited"**, company no. 145174A02102026 (terms, privacy, home, side panel, tracking footer).
"Sky Innovations Limited" appears only in the spec. They are not equated here. **Owner review required** (see owner-review document). No legal text will be changed.

## 5. Platforms (separate tracks)
| Platform | Status | Evidence |
| --- | --- | --- |
| Web (production) | Deployed from `main`; unit/DB tests green | V CI |
| Android APK | Build-only: CI `build-android-apk` green; no real-device test | V check run; U device |
| iOS | **Not ready**: no `ios/` project, no APNs configuration in repo | V `ls ios` |
| Web push | Implemented (`push.ts`, `push_subscriptions`, edge `send-push`); delivery not verified | C, U |
| Android FCM | Native token path exists (`native-push.ts`, `device_tokens` 0059); delivery not verified on a device | C, U |
| iOS APNs | Not applicable until an iOS project exists | V |

## 6. Plan for Stages 1-10 (what is safe to do autonomously)
1. Onboarding: reuse `OnboardingWalkthrough`, `GuidedTourProvider`, `tour_progress` (0039 live); check first-run skippable flow for both roles. Code only.
2. Agreement: versioned structure exists (0157); verify reconfirmation-on-change and preserved versions with pgTAP before extending.
3. Demo isolation: read-only inventory of demo/test data and any demo code path; **no deletion** (needs protected accounts + backup + owner).
4. Pricing: confirm no hidden origin; dated, sourced competitor refresh; calibration report only if thresholds met.
5. Admin/KYC/RLS audit, read-only first.
6. Payments: Paynow top-up audit and `docs/payments/CONZ_PAYMENT_INTEGRATION_HANDOVER.md`; Linkwa = unapproved.
7. Copy audit fixes (code only), UI/accessibility pass at 360/390/768/1280, light and dark.
8. Tests and docs; 9. PR -> CI -> merge -> verify deploy (code-only); 10. Final owner report.
Anything touching live money, RLS on sensitive data, legal text, provider settings or deletion goes to the owner-review document, not to production.

## 7. Stage results
- **Stage 1 onboarding (V, code read):** `OnboardingWalkthrough` (2 slides + optional permissions step) is skippable (X and "Skip for now"), waits until Terms are accepted
  (`firstRunStage`), separate from consent. Notifications/location are optional taps, never forced. Help tours replay with Start / Continue / Restart (`tour_progress` 0039 live).
  No code change needed. Remaining nuance: the permission step asks in the walkthrough rather than only at point of use; both prompts are optional, so left as is.
- **Stage 2 agreement (V, migration 0157 read):** versioned (`unique (job_id, version)`), both parties accept the same version, a new proposal supersedes the open one (reconfirmation),
  old versions kept (no client write grants, no delete path), fare copied from the job. **Finding F-AGR-1:** either party can propose a nonzero deposit; the spec says
  deposit is Driver-proposed, Customer-accepted. Fix needs a migration plus AgreementCard change: carry the driver's deposit over when the customer re-proposes and refuse a
  customer-set deposit. Rights rule, so listed for owner confirmation (owner-review #14).
- **Stage 5 access-control audit (V, read-only live queries 09/11):** all public tables have row-level security (0 without); the 3 storage buckets (`driver-docs`, `job-proof-photos`,
  `chat-media`) are private; no storage SELECT policy for anon/public; anon can execute only 5 SECURITY DEFINER functions (`transport_pricing_enabled`, `has_role`,
  `compute_material_offer`, `public_material_pickups`, `get_public_tracking`), each already on the reviewed list; the only `using (true)` policies for anon are public reference
  data (prices, price buckets, small-load settings, supply locations, supplier listings; supplier contact columns were hidden by 0115). pgTAP `060_kyc_protection` covers KYC.
  Not done here: a human walk-through of the admin KYC review screen, and a test of every role against every table over HTTP.
- **Stage 6 payments:** `docs/payments/CONZ_PAYMENT_INTEGRATION_HANDOVER.md` written (settings verified live; Linkwa out of scope).
- **F-AGR-1 resolved (09/11):** 0162 makes the deposit Driver-proposed: a customer's new version keeps the latest non-declined deposit, a different amount is refused (`Only the driver can propose or change a deposit`). Card shows customers a read-only deposit line. Local checks: pgTAP full suite 90 files / 1827 tests PASS, undo script and re-apply tested on the local stack, 857 unit tests.
