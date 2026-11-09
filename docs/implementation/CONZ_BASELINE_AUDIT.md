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
- Not found in `src/`: "first job free" (grep clean outside admin). Terms/help may still describe it in long text: re-check in Stage 7 with full-page read.

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
