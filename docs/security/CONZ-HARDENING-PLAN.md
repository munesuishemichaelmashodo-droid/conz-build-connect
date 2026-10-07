# Con Z — Production Hardening Plan

**Created:** 07/10/2026 (Phase 0 baseline) · **Branch:** `security/hardening` (local, not pushed)
**Scope:** payment safety, financial integrity, access control, test suite, staging, Google Play readiness.

> **Confidential.** Describes unfixed weaknesses in a live financial system. Keep the repo private.

**Safety rules for this work:** no deploys, no live migrations, no real payments, no production data
changes. Every migration below is written and tested against a non-production database first and is
applied to production only after explicit owner approval (and then under the CLAUDE.md rule: the
`.sql` file is committed in the same sitting).

---

## 1. Baseline (Phase 0, verified 07/10/2026)

### 1.1 Repository

| Item | Value |
|---|---|
| HEAD | `eb7e66f` on `main`, clean working tree |
| Stack | TanStack Start (React 19, Vite 8, Nitro) on Vercel; Supabase (Postgres 17, Auth, Storage, Realtime, pg_cron, pg_net); Paynow; Capacitor 8 Android (`com.conz.app`, targetSdk 36) |
| Package manager | npm (`package-lock.json`); a stale `bun.lock` also exists (two lockfiles) |
| Build | `npm run build` = `vite build` + `scripts/verify-build.mjs` (boots the compiled Vercel function and hits 5 routes) |
| CI | `.github/workflows/verify-build.yml` (build + debug APK), `android-build.yml` (debug APK). **No typecheck, lint or tests in CI.** |
| Tests | **None.** (Two Capacitor template stubs under `android/app/src/*Test*`.) |
| Migrations | 97 files in `supabase/migrations/`; sequential counter currently **0071**; latest file `20261007071444_restore_prior_function_revokes.sql` |
| Baseline commands | see §1.5 |

### 1.2 Migration drift check (CLAUDE.md requirement)

Live `supabase_migrations.schema_migrations` vs git, matched by **name** (git files use hand-picked
timestamps, live records apply-time):

- Every migration from `0063` through `restore_prior_function_revokes` (07/10) is present in both. **No new drift.**
- Known historical mismatches only: the 14–15/08 referral + MFA block (covered in git by
  `0038_reconcile_referral_mfa_migrations`), `0043_default_pricing_version`, `0057_next_load_empty_km_v2`
  (git: `0057_next_load_empty_km`), and `0058`/`0059` (in git and live, never recorded).
- **Consequence:** because pre-0063 history is reconstructed, new migrations are written from the
  **live** function definitions (`pg_get_functiondef`), not from older migration files.

### 1.3 Live data baseline (aggregate, read-only)

| Check | Result |
|---|---|
| Wallets | 5; 0 negative balance; 0 negative held; 0 NaN/±Infinity; 0 limited |
| Wallet ↔ ledger | **0 mismatches** (`sum(wallet_transactions.amount) = wallets.balance` for every wallet) |
| Bids | 41; 0 with price ≤ 0 / NaN / ±Infinity |
| Jobs | 74 (57 cancelled, 9 completed, 5 in_progress, 1 accepted, 2 open); 61 direct, 13 escrow |
| Jobs violating proposed CHECKs | **1** — cancelled direct-pay job from 21/07/2026 with `budget = 0.00` → constraints must be added `NOT VALID` |
| Payments | topup: 12 paid, 20 failed · escrow: 3 failed · **0 escrow payments have ever been paid** |
| Withdrawal requests / manual top-up requests | 1 / 6 |
| Pricing enforcement | all materials enforced **except `custom`** (no budget validation for custom jobs) |
| Verified drivers | 6 |

### 1.4 Toolchain on this machine

| Tool | Status |
|---|---|
| Node 24.21 / npm 11.19 | ✅ |
| Docker Desktop | ❌ installed but "unable to start" |
| WSL | ❌ no distribution installed |
| psql / Supabase CLI | ❌ not installed (CLI is a devDependency, needs Docker for `supabase start`) |

**Implication:** a local Supabase stack cannot run here today. See §6 (decision required).

### 1.5 Baseline command results

Run on Windows after `npm ci` (npm 11 skipped dependency install scripts for esbuild/sharp/core-js; the
build did not need them).

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0, 0 errors |
| `npm run lint` | ❌ 32,431 errors / 27 warnings — **30,690 are `Delete ␍`** (CRLF from `core.autocrlf=true` on this Windows checkout, not repo content). Real debt ≈ **1,741**: ~1,577 prettier formatting, 160 `no-explicit-any`, 22 `react-refresh/only-export-components`, 4 `no-empty`, 3 unused disable directives, 2 `exhaustive-deps`. |
| `npm run build` | ⚠️ `vite build` ✅ (client, SSR, Nitro bundles); post-build smoke test ❌ on Windows only: `scripts/verify-build.mjs` passes a `c:\…` path to `import()` (`ERR_UNSUPPORTED_ESM_URL_SCHEME`) — needs `pathToFileURL`. Linux CI unaffected. |

Lint gate plan (Phase 17): add `.gitattributes` `* text=auto eol=lf` + `endOfLine: "auto"` decision,
one formatting-only commit (`prettier --write`, no logic changes), then hold lint at 0.

---

## 2. Architecture (where the money logic actually lives)

```
Browser / Android WebView (www.conz.co.zw)
  ├─ supabase-js (publishable key + user JWT) ─► PostgREST / Realtime / Storage / Auth
  └─ TanStack server fns + /api/public/paynow-ipn (Vercel, SERVICE ROLE) ─► Paynow
Postgres = the enforcement layer: RLS + guard triggers + 114 SECURITY DEFINER functions + pg_cron
Edge Functions: send-push (secret-gated), send-sms (fail-open, not in git), smooth-handler + quick-responder (demo)
```

- **Payment code:** `src/lib/paynow.server.ts` (hash, initiate, poll), `src/lib/paynow.functions.ts`
  (`initiatePaynowTopup`, `initiateEscrowPayment`, `reconcilePendingPaynowPayments`),
  `src/routes/api/public/paynow-ipn.ts` (IPN), UI in `wallet.tsx` / `jobs.$id.tsx`.
- **Money RPCs (live):** `credit_wallet_from_payment`, `mark_escrow_payment_paid`,
  `release_escrow_and_complete`, `auto_release_escrow_payments` (service_role only);
  `complete_job`, `accept_bid`, `accept_counter`, `accept_dispatch_offer`, `hold_job_commission`
  (service only), `release_job_commission` (service only), `cancel_job`, `resolve_dispute`,
  `request_withdrawal`, `request_topup`, `admin_approve_*`, `admin_reject_*`, `admin_credit_wallet`,
  `admin_wallet_adjust`, `admin_wallet_reverse`, `set_withdrawal_pin`, `driver_confirm_delivery_pin`.
- **Cron:** escrow auto-release, accepted/open job expiry, referral lifecycle, dispatch sweep, GPS prune,
  dispute escalation.
- **Privileged RPC inventory:** 114 SECURITY DEFINER functions; 4 anon-callable (`compute_material_offer`,
  `get_public_tracking`, `has_role`, `public_material_pickups`); ~70 authenticated-callable; rest service-only.

---

## 3. Vulnerabilities (verified against live definitions on 07/10/2026)

| ID | Sev | Finding | Root cause (live) |
|---|---|---|---|
| F1 | **CRITICAL** | Money minting via negative / ±Infinity bid price or custom-material budget | `bids.price`, `jobs.budget/final_price` have no CHECK; `accept_bid`/`accept_counter`/`accept_dispatch_offer` copy them into `final_price`; `driver_can_accept_for` passes negative requirements; `complete_job` does `balance - commission` with negative commission → credit. `wallets` has no CHECKs, so NaN balances defeat every `<` comparison in withdrawal paths. `admin_credit_wallet`/`admin_wallet_adjust` accept NaN/Infinity for super_admin. |
| F2 | HIGH | Paid escrow stranded on cancel / expiry / dispute | `cancel_job`, `expire_stale_accepted_jobs` never touch `payments`; `auto_release_escrow_payments` only scans accepted/in_progress; `resolve_dispute('refund')` refunds only the commission. |
| F3 | HIGH | Paynow state regression, replay, no amount/reference checks, refunds never debited | `paynow-ipn.ts` failure branch writes `failed` with no prior-status guard; signed poll bodies are user-fetchable (`payments_owner_select` exposes `paynow_poll_url`) and replayable; IPN/poll `amount` and `reference` never compared; hash compare not constant-time; IPN `resultUrl` host 308-redirects. |
| F4 | HIGH | Withdrawal / top-up requests mutable after submission | policies `wd_owner_cancel` / `topup_owner_cancel` allow UPDATE of every column while pending; no guard trigger → payout `destination`/`amount` rewritable after PIN check. |
| F5 | HIGH | Admin self-credit | `admin_wallet_adjust`: any admin, no self-target check, $500/call with unlimited calls. |
| F6 | HIGH | KYC editable after verification | `driver_profiles_guard_direct_write` doesn't freeze identity/document columns; storage policy `driver docs: owner rw` (ALL) allows overwrite/delete; `driver-docs`, `chat-media` buckets have no size/MIME limits. |
| F7 | MED | Withdrawal-PIN lockout bypass | `set_withdrawal_pin(_pin,_current_pin)` verifies the current PIN with no attempt counting → unlimited brute-force oracle. |
| F8 | MED | Access control | `activateAccount` trusts `user_metadata.role`; `self_add_base_role('driver')`; any driver-role user reads all open jobs incl. address/coords/`tracking_token`; `get_public_tracking` tokens never expire; `log_admin_action` callable by any user (forged audit rows); open redirect (`/\evil.com`) in `oauth-callback.tsx`/`auth.tsx`; hard-coded super-admin e-mail. |
| F9 | MED | Operational | `send-sms` fails open + not in git; demo Edge Functions live; escrow reconcile only when the customer opens the job page; no ledger reconciliation; escrow payouts logged as `topup`; no platform-revenue / escrow-liability ledger; account deletion incomplete; admin MFA removed (owner decision 25/09). |
| P | MED | Pricing inputs | `jobs_guard_insert` keeps client `pickup_lat/lng`, `supply_location_id`, `preferred_driver_id`, `quote_id`; `create_price_quote` accepts any distance / supply id (bounded only 0.95–3× client haversine). |

---

## 4. Remediation phases and migration order

Each phase: inspect → write migration/code → pgTAP/unit tests → diff review → tsc + lint + build → commit.
Numbering continues the sequential counter. **None of these are applied live during this work.**

| Order | Migration (proposed) | Phase | Content |
|---|---|---|---|
| 1 | `0072_financial_numeric_integrity` | 1 | `NOT VALID` CHECKs (finite, > 0) on `bids.price`, `bids.customer_counter_price`, `jobs.budget`, `jobs.final_price`, `jobs.quantity_m3`, `jobs.commission/held_commission ≥ 0`, `payments.amount` finite, `wallets.balance` finite, `wallets.held` finite ≥ 0, `wallet_transactions.amount` finite; a shared `assert_money(numeric)` helper; validation inside `accept_bid`, `accept_counter`, `accept_dispatch_offer`, `complete_job`, `hold_job_commission`, `release_escrow_and_complete`, `admin_credit_wallet`, `admin_wallet_adjust`, `counter_bid`, `raise_job_budget`; commission can never be negative. |
| 2 | `0073_payment_state_machine` | 2 | `payments` transition trigger (initiated → paid / failed / cancelled; paid → released / refund_due; refund_due → refunded; terminal states frozen); `payment_events` log (raw Paynow status, amount, reference, hash-valid, outcome); `expected_amount` is the stored amount. |
| 3 | (app code) | 2–3 | IPN + poll: constant-time hash compare, reference = payment id, amount == stored amount, poll URL host allowlist, status-guarded updates, mismatches recorded + admin alert; server-side scheduled reconcile (Vercel cron route, secret-gated) for top-ups **and** escrow. `SITE_URL`/resultUrl → `https://www.conz.co.zw`. |
| 4 | `0074_escrow_refund_lifecycle` | 4 | `refund_due` / `refunded` payment states; `cancel_job`, `expire_stale_accepted_jobs`, `resolve_dispute` move paid escrow to `refund_due` (+ admin notification + ledger entry); `admin_mark_escrow_refunded` (super_admin, idempotent, ≤ escrow amount); release blocked after refund and vice versa. **Refund mechanics need an owner decision (§6).** |
| 5 | `0075_financial_request_immutability` | 5 | Guard trigger on `wallet_withdrawal_requests` / `wallet_topup_requests`: owners may only move pending → cancelled; all other columns frozen; admin decisions only through the RPCs. |
| 6 | `0076_admin_money_controls` | 6 | `admin_wallet_adjust`: self-target blocked, daily per-admin cap across calls, finite checks; `log_admin_action` admin-only; MFA per owner decision (§6). |
| 7 | `0077_kyc_freeze` | 7 | Changing any identity/document column on a verified profile forces `verification_status = 'pending'` (re-review) and notifies admins; storage: owner INSERT-only for `driver-docs` (no UPDATE/DELETE), size + MIME limits on `driver-docs` and `chat-media`. |
| 8 | `0078_withdrawal_pin_lockout` | 8 | `set_withdrawal_pin` counts failed current-PIN attempts in `pin_attempts` (shared with `request_withdrawal`), honours lockout; failure counting committed even though the call raises (return-error pattern instead of raising after the counter update). |
| 9 | `0079_roles_and_job_visibility` | 9–10 | Driver-only data (open jobs, addresses, tracking tokens) gated on **verified** driver, not the self-grantable role; `tracking_token` and exact coordinates removed from non-party reads (column-level grants / RPC); tracking token expiry after completion; `activateAccount` stops trusting `user_metadata.role` for anything privileged. |
| 10 | `0080_pricing_input_integrity` | 11 | `jobs_guard_insert` nulls client `supply_location_id` (only the quote may set it), validates coordinate ranges, validates `preferred_driver_id` is a verified driver; `create_price_quote` validates supply location + distance bounds server-side; `custom` material requires admin pricing or a bounded budget. |
| 11 | `0081_ledger_reconciliation` | 15 | `financial_reconciliation()` (read-only report: wallet vs ledger, duplicate credits per payment, escrow liability vs paid escrow, released escrow vs driver credits + commission); scheduled check that **flags** (never auto-fixes); escrow release ledger type corrected going forward. |

App-side phases: 12 (send-sms fail-closed, committed to git; demo functions removed only after
confirmation), 13 (open-redirect fix, App Links), 14 (account deletion completeness),
17 (CI: typecheck + lint + tests + build), 20 (Android).

---

## 5. Test strategy

**Database (primary):** pgTAP files in `supabase/tests/database/*.test.sql`, run with
`supabase test db` against a **local Supabase stack** (all migrations replayed from scratch). Each test
switches identity with `set local role authenticated` + `request.jwt.claims`, runs inside a
transaction, and is rolled back. Every financial fix ships with:

- the attack reproduced (expected: error / no balance change), and
- the happy path (expected: unchanged behaviour), and
- a ledger-invariant assertion (`sum(ledger) = balance`) after the scenario.

**Application:** Vitest unit tests for `paynow.server.ts` (hash, constant-time verify, response
parsing) and for the IPN / reconcile decision logic, extracted into a pure function so it can be tested
with a mocked database.

**CI:** `verify-build.yml` gains `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, and a
database job that runs `supabase start` + `supabase test db` on the GitHub runner (Docker is available
there). CI never receives production credentials.

**Paynow:** never called by tests. Paynow responses are generated locally with a test integration key
and fed to the handler; a real end-to-end run happens only on staging with a separate Paynow
**test-mode** integration.

---

## 6. Decisions required before the affected phases

1. **Test database** — local Supabase needs Docker (currently failing) or WSL; alternative is a
   separate staging Supabase project. Without one, database fixes can be written but **not tested**,
   and per the safety rules cannot be called fixed.
2. **Escrow refund mechanics (Phase 4)** — refund to the customer's Con Z wallet vs. back through
   Paynow (manual via merchant portal, then marked refunded) — and who decides the split on disputes.
3. **Admin MFA (Phase 6)** — MFA was removed by owner decision on 25/09/2026. Re-enable for
   super_admin money actions, or keep off and rely on caps + two-person rules.
4. **Admin adjustment limits (Phase 6)** — per-call / per-day caps and whether ordinary admins may
   credit at all.

Defaults taken without asking (preserve existing behaviour):

- Driver wallets may still go **negative** only through the existing direct-pay commission debit
  (sets `limited`), but must always be finite; `held` must be ≥ 0.
- The `driver` role remains self-grantable as an **applicant** marker (the become-driver flow needs it);
  all driver privileges are gated on verification instead.

---

## 7. Deployment gates

Nothing reaches production until every gate is green and the owner approves in writing.

| Gate | Evidence required |
|---|---|
| G1 Build | `npm run build` passes |
| G2 Typecheck | `npx tsc --noEmit` exit 0 |
| G3 Lint | `npm run lint` exit 0 (or documented, owner-accepted baseline) |
| G4 DB tests | `supabase test db` all pass on a fresh local/staging DB |
| G5 App tests | `vitest run` all pass |
| G6 Ledger | reconciliation reports 0 discrepancies on staging after the full scenario run |
| G7 Staging | separate Supabase project + separate Paynow **test** integration + separate secrets |
| G8 Audit | fresh read-only audit (Phase 19) marks F1–F9 FIXED with test evidence |
| G9 Prod apply | owner approval; migrations applied in order; each `.sql` committed in the same sitting; post-apply read-only verification of function bodies + grants |

**Production migration procedure (when approved):** apply `0072`…`0081` in order to production via
`supabase db push` (or MCP `apply_migration` using the exact file name), verify with read-only
introspection, run the reconciliation report, deploy the app after the DB (app changes are
backwards-compatible with the new DB, not vice versa), and keep the Paynow IPN path monitored for 24h.
