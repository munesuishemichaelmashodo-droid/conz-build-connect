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

**Owner decisions (07/10/2026):**

| # | Decision |
|---|---|
| 1 | **Test DB:** fix Docker locally → local Supabase (`supabase start`) + pgTAP; same in GitHub CI. A staging Supabase project is still required later for the Paynow test-mode run (gate G7). |
| 2 | **Escrow refunds via Paynow:** paid escrow on cancel / expiry / customer-favoured dispute → `refund_due` + admin alert; a super_admin refunds through the Paynow merchant portal, then marks the payment `refunded` in Con Z (ledger entry, idempotent, ≤ escrow amount). Nothing is credited to in-app wallets. Disputes: release or refund **in full**, no partial splits. |
| 3 | **Admin money protection: MFA *and* caps.** Re-enable TOTP (Supabase `aal2`) and require it for super_admin money actions (credits, adjustments, withdrawal/top-up approvals, refund marking, reversals); plus daily caps and a second-admin approval above a threshold. |
| 4 | **`admin_wallet_adjust`:** ordinary admins may only **debit**; credits are super_admin only, never self-targeted, capped per day (default $500/day). |

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

---

## 8. Phase log

### Test infrastructure (07/10/2026)

- `scripts/db-test.mjs` builds `.dbtest/` (gitignored): the 13/08 baseline + every later migration
  (the full history is **not replayable** on a fresh DB — it fails at `20260723213127` on
  `dispute_category`), `supabase/test-fixtures/reference_data.sql` (non-personal pricing/settings
  rows) appended to the baseline copy, and `supabase/test-fixtures/test_helpers.sql` (pgTAP, identity
  switching via role + JWT claims, fixtures) as a final test-only migration. Own project id
  (`conz-dbtest`); never linked to the hosted project.
- **Fidelity:** after replay, 142/145 public functions are code-identical to live (comments/whitespace
  ignored). Differences: `admin_wallet_adjust` (equivalent CASE expression), and `search_path`
  on the retired MFA functions `generate_mfa_recovery_codes` / `redeem_mfa_recovery_code`.
- **Safety:** `tg_send_push_on_notification` hard-codes the PRODUCTION `send-push` URL; the test
  bootstrap disables that trigger locally. Verified `net.http_request_queue` empty.

### Phase 1 — Financial numeric integrity (F1) ✅ tested locally

- **Migration:** `20261007210000_0072_financial_numeric_integrity.sql`
  - `is_valid_money(v, max=100000)`: `0 < v <= max` (also rejects NaN/±Infinity, since NaN sorts above all numbers).
  - `NOT VALID` range CHECKs: `bids.price`, `bids.customer_counter_price`, `jobs.budget/final_price/
    quantity_m3/delivered_quantity_m3/commission/held_commission`, `payments.amount`,
    `trucks.capacity_m3`, `price_quotes.distance_km/quantity_m3`, `wallet_transactions.amount/balance_after`;
    `wallets.balance` (finite, floor −100,000) and `wallets.held` (≥ 0) **validated**.
  - Re-validation inside `counter_bid`, `raise_job_budget`, `accept_bid`, `accept_counter`,
    `accept_dispatch_offer`, `hold_job_commission`, `complete_job` (commission ∈ [0, price]),
    `release_escrow_and_complete` (split ∈ [0, amount]), `admin_credit_wallet`, `admin_wallet_adjust`.
- **Tests:** `supabase/tests/database/010_financial_numeric_integrity.test.sql` — 39 assertions.
  Before the fix: negative bids, NaN/negative/zero budgets, NaN/Infinity counter-offers and NaN budget
  raises were all **accepted** (16 failures + abort). After: **39/39 pass**, including the end-to-end
  minting attack (legacy negative price → `accept_bid`/`complete_job`/`accept_dispatch_offer` refuse,
  driver balance unchanged) and the happy path (7% = $28 commission, ledger = balance).
- **Production compatibility (read-only check):** 0 violating rows except the known cancelled $0 job
  (left untouched by `NOT VALID`; any future UPDATE of that one row would be rejected).
- **Remaining risk:** limits ($100k job/bid, 1,000 m³, 100 m³ trucks, 5,000 km) are engineering
  defaults consistent with existing caps; owner may tune.

### Phases 2–3 — Payment state machine + server-side reconciliation (F3, F9) ✅ tested locally

- **Migration:** `20261007220000_0073_payment_state_machine.sql`
  - State machine trigger on `payments`, enforced for **every role incl. service_role**:
    `initiated → paid | failed | cancelled`, `paid → released | refund_due`, `refund_due → refunded`.
    Identity columns + `amount` immutable; poll URL set once; payments undeletable.
  - `payment_events` (append-only, admin-readable) records every Paynow observation + decision.
  - `apply_paynow_result()` (service_role only) — reference == payment id, amount == stored amount
    (string-parsed, NaN/garbage rejected), single credit, no regression; late success after close,
    refund/chargeback after payment, and mismatches are **flagged to admins, never auto-applied**.
  - `credit_wallet_from_payment` / `mark_escrow_payment_paid` only act on `initiated`.
  - Clients lose SELECT on `payments.paynow_poll_url` (closed the signed-poll-body replay source).
  - Reconciliation: `paynow_pending_for_reconcile()`, `expire_stale_paynow_payment()` (unsent > 1h,
    unpaid-at-Paynow > 72h → `cancelled`), `request_paynow_reconcile()` + pg_cron `paynow-reconcile`
    every 10 min — **inert until the owner sets `app_secrets.paynow_reconcile_url` and
    `paynow_reconcile_secret`** (and the matching `PAYNOW_RECONCILE_SECRET` env var on Vercel).
- **App:** `src/lib/paynow.server.ts` (constant-time compare, duplicate-field rejection, Paynow-host
  allowlist, signed initiate response verified, `processPaynowIpn()`), `src/routes/api/public/paynow-ipn.ts`
  (thin wrapper), `src/lib/paynow.reconcile.server.ts`, new `src/routes/api/internal/paynow-reconcile.ts`
  (secret-gated, 503 when unconfigured), `paynow.functions.ts` (escrow re-pay check and user reconcile go
  through the verified path; escrow amount must be finite and in range), `src/lib/site.ts` →
  `https://www.conz.co.zw` (IPN resultUrl no longer hits the 308 redirect).
- **Tests:** pgTAP `020_payment_state_machine.test.sql` 43 assertions (credit once; duplicate / poll-after-IPN /
  late Cancelled / late Failed / Refunded / replay-after-reversal; reference, amount, NaN, garbage, missing
  amount mismatches; late success after cancel; illegal transitions as service_role; immutability; escrow
  credited to nobody; client column privacy; reconcile helpers). Vitest `tests/unit/paynow.server.test.ts`
  16 tests (hash vs independent implementation, tamper, wrong key, duplicates, allowlist, IPN status codes).
  **Results: DB 82/82, unit 16/16, `tsc` 0 errors, build + smoke test pass (now also on Windows).**
- **Behaviour change to note for production:** Paynow's *initiate* response is now hash-verified (as the
  official Paynow SDKs do); an unsigned/invalid response fails the initiation instead of redirecting.
- **Remaining risk:** real Paynow message formats (amount formatting, status strings) are verified only
  against the documented format until the staging test-mode run (Phase 18).

### Phase 4 — Escrow refund lifecycle (F2) ✅ tested locally

- **Migration:** `20261007230000_0074_escrow_refund_lifecycle.sql`
  - `require_aal2()` (MFA session check) — first user: refund confirmation.
  - `platform_ledger` — append-only double-entry ledger (debit +, credit −, every group sums to 0;
    super_admin read). Escrow postings: `escrow_paid` (paynow_clearing / escrow_held),
    `escrow_released` (escrow_held / user_wallets + platform_revenue), `escrow_refund_due`
    (escrow_held / refunds_payable), `escrow_refunded` (refunds_payable / paynow_clearing).
  - `escrow_refunds` work queue; `escrow_mark_refund_due()` (paid → refund_due, queue, ledger, alerts
    to customer + super admins; idempotent) used by `cancel_job`, `expire_stale_accepted_jobs`,
    `resolve_dispute('refund')`, and `mark_escrow_payment_paid` (payment landing after the job closed,
    or a duplicate payment).
  - `resolve_dispute`: escrow `refund` = full refund_due + job cancelled + held commission released;
    any other outcome keeps escrow held for normal release ("release in full"); refund requested after
    release → super admins alerted, no automatic credit; **admins can no longer resolve disputes on jobs
    they are a party to.**
  - `admin_mark_escrow_refunded()` — super_admin + **MFA (aal2)**, not own payment, Paynow refund
    reference required, idempotent, full amount, ledger + audit + customer notification.
- **App:** `jobs.$id.tsx` shows the customer "being refunded / refunded" for refund_due/refunded escrow.
- **Tests:** `030_escrow_lifecycle.test.sql` 54 assertions — pay→complete→release ($279 to driver,
  $21 revenue), double release, refund-after-release, cancel→refund_due→refunded (admin denied,
  super_admin without MFA denied, with MFA OK, idempotent), release-after-refund (incl. direct status
  UPDATE as service_role), 24h expiry→refund_due, dispute→refund in full, dispute other outcome→release,
  self-dealing dispute blocked, late payment after cancel, duplicate payment, ledger: every group
  balances, escrow_held = Σ paid escrow, refunds_payable = Σ refund_due, append-only.
  **DB total: 136/136.** `tsc` clean.
- **Pending (Phase 6):** admin screen to work the refund queue (needs the MFA sign-in flow).

### Phase 5 — Financial request immutability (F4) ✅ tested locally

- **Migration:** `20261008000000_0075_financial_request_immutability.sql` — `financial_request_guard()` on
  `wallet_withdrawal_requests` + `wallet_topup_requests` for **every role**: amount, method, note,
  destination/reference, owner, created_at frozen; status only pending → cancelled|approved|rejected,
  decided requests final; client roles may only cancel their own pending request. Dropped
  `wd_admin_update` / `topup_super_admin_update` (direct approval skipped the money movement) and the
  dead INSERT policies; revoked client DELETE/TRUNCATE.
- **App impact:** none — the UI already uses `request_*`, `cancel_*`, `admin_approve_*`, `admin_reject_*`.
- **Tests:** `040_financial_request_immutability.test.sql` 27 assertions (destination/amount/method/note
  rewrite after PIN check, self-approval, decision fields, other user, admin + super_admin direct approval,
  service_role rewrite, RPC approval debits exactly the authorised amount, final states, owner cancel,
  revive, delete, top-up amount/reference, ledger invariant). **DB total: 163/163.**

### Phase 6 — Admin money controls (F5, F8 audit forgery) ✅ tested locally

- **Migration:** `20261008010000_0076_admin_money_controls.sql`
  - `admin_money_guard()` — single gate for every admin wallet change: admin/super_admin only, **no
    self-target**, valid amount, advisory lock per admin (no cap race), **credits super_admin-only + MFA**,
    super_admin debits need MFA, credits above the threshold raise `SECOND_APPROVAL_REQUIRED`, daily caps
    per direction recorded in append-only `admin_money_actions`.
  - Defaults in `system_settings.admin_money_controls` (changeable only via `admin_set_money_controls`,
    super_admin + MFA, audited): admin debit $500/day, super_admin debit $500/day, super_admin credit
    $500/day, **second approval above $100**. Production has 2 super_admins (checked read-only), so the
    two-person flow is usable; with one, large credits are impossible (fail-safe).
  - `admin_apply_wallet_change()` — wallet + ledger row + `platform_ledger` (admin_adjustments ↔
    user_wallets) + audit + notification. `admin_wallet_adjust`, legacy `admin_credit_wallet`,
    `admin_wallet_reverse` (super_admin + MFA, once only via unique index) all route through it.
  - Two-person credits: `admin_credit_requests`, `admin_request_wallet_credit()` / `admin_decide_wallet_credit()`
    (second super_admin, MFA, not requester, not target, 48h expiry, applied once).
  - `admin_approve_topup` → super_admin + MFA; `admin_approve_withdrawal` → MFA when the approver is a super_admin.
  - `log_admin_action` no longer client-executable; `admin_audit_log` append-only for every role; client
    INSERT/UPDATE/DELETE revoked. `require_aal2()` now raises `MFA_REQUIRED: …` for the UI.
- **App:** restored `/mfa` (enrol/challenge, from history `052e42c^`, now with `safeInternalPath`);
  `src/lib/mfa.ts`, `src/lib/safe-redirect.ts`; `admin.users.tsx` (credit button super-only, MFA "Verify"
  action, second-approval request flow), `admin.revenue.tsx` (MFA handling on approvals), new
  **Admin → Approvals** (`admin.approvals.tsx`: escrow refund queue + credit requests), nav tab added.
- **Tests:** `050_admin_money_controls.test.sql` 45 assertions (user/admin/super paths, caps cannot be split,
  MFA, self-credit, threshold, two-person flow incl. requester/target/ordinary-admin/no-MFA denials,
  reject, reversal once, controls tuning, audit forgery + append-only, ledger balance + invariant).
  `tests/unit/safe-redirect.test.ts` 12 tests. **DB 208/208, unit 28/28, tsc clean, build + smoke pass.**
- **Deployment consequence (owner action):** after deploy, every super_admin must enrol an authenticator
  at `/mfa` before approving top-ups/withdrawals, crediting, reversing, or confirming refunds. Supabase
  Auth TOTP MFA must be enabled for the project (it is on by default; verify in the dashboard). Lost
  device recovery: remove the factor in Supabase dashboard → Authentication → Users.

### Phase 7 — KYC protection (F6) ✅ tested locally

- **Migration:** `20261008020000_0077_kyc_protection.sql`
  - `driver_profiles_guard_direct_write`: a **verified** driver changing any identity/document column
    (national ID + number, nationality, selfie, licence, operator licence, fitness certificate, GIT
    insurance, ZINARA, tipper photos) is automatically returned to `pending` (verified_at/reverify cleared,
    note recorded, admins notified) → cannot bid until re-approved. Drivers also can no longer set
    `verified_at` / `reverify_due_at`.
  - `driver-docs` storage: owner read + upload of new files in own folder only; overwrite/delete only while
    **not verified**; other users no access; admin policy recreated. Buckets created idempotently with limits:
    `driver-docs` 15 MB images+PDF, `chat-media` 15 MB images+audio (live objects checked: only JPEG/PNG ≤ 3.2 MB).
  - Note: the local test DB had no storage buckets/policies (baseline covered `public` only); this
    migration is self-contained so fresh and live databases converge.
- **App:** KYC uploads use `upsert: false` (paths are already unique); voice notes upload with the bare
  MIME type (`audio/webm`, not `audio/webm;codecs=opus`).
- **Tests:** `060_kyc_protection.test.sql` 19 assertions (re-verification on ID/number/compliance change,
  no bidding while pending, no self-verify, approved files cannot be overwritten/deleted, new uploads allowed,
  applicant can manage files, cross-user read/upload denied, admin read, bucket limits). **DB 227/227.**

### Phase 8 — PIN lockouts that count (F7 + NEW HIGH finding) ✅ tested locally

- **New finding (proven, then fixed):** `request_withdrawal` and `driver_confirm_delivery_pin` incremented
  their failure counters and then **raised**, which rolled the increment back with the request — so
  **neither lockout ever engaged** (the probe test showed `fail_count = 0` after wrong PINs). Impact: unlimited
  withdrawal-PIN guessing, and the assigned driver could **brute-force the customer's 6-digit escrow
  delivery PIN** and release escrow to themselves. Severity **HIGH** (escrow integrity). The 04/10
  remediation report marked the delivery-PIN lockout "FIXED"; it was not effective.
- **Migration:** `20261008030000_0078_pin_lockout_that_counts.sql` — PIN checks now **return**
  `{ok:false, error:"wrong_pin"|"locked", message, attempts_left|locked_until}` instead of raising, so the
  counter commits. `check_withdrawal_pin()` (shared by `request_withdrawal` and `set_withdrawal_pin`):
  locked → PIN not evaluated (no oracle); 5 failures → 15 min, 10+ → 24 h; only a correct PIN resets.
  Delivery PIN: same policy per job, customer warned after 5 wrong codes. Return types changed
  (row/void → jsonb): functions dropped/recreated with explicit grants.
- **App:** `src/lib/rpc-result.ts` (`rpcFailure`, accepts old + new shapes) used in `wallet.tsx`,
  `profile.tsx`, `jobs.$id.tsx`. **Deploy order: app first, then migration.**
- **Tests:** `070_pin_lockout.test.sql` 31 assertions (counted, lock at 5, correct PIN refused while locked,
  PIN change refused while locked, no requests created, unlock + reset, 24 h escalation, change-PIN oracle
  counted, shared counter across both paths, old PIN invalid after change, delivery PIN counted/locked/
  customer warned/correct refused while locked/release once). Unit `rpc-result.test.ts` 2.
  **DB 258/258, unit 30/30, tsc clean.**
- **Remaining:** no forgotten-PIN reset flow exists (a locked-out user waits; support has no tool) — product gap.

### Phases 9–10 — Roles, open-job visibility, tracking (F8) ✅ tested locally

- **Migration:** `20261008040000_0079_roles_and_job_visibility.sql`
  - `is_verified_driver(uid)` = driver role + verified profile + not past re-verification. Used by the
    `Jobs visibility` policy (open jobs), `driver_available_jobs` and `find_next_loads_for_driver` (return
    nothing to unverified callers instead of every open job's address/coords/notes/token).
  - Tracking token **rotated when a job leaves `open`** (trigger), so a token seen during bidding never
    reveals the assigned driver's live location; `get_public_tracking` returns nothing for cancelled jobs or
    90 days after completion. (Chosen over column revocation because three pages `select("*")` from jobs.)
  - `admin_grant_role` → MFA required for admin / super_admin grants.
  - `driver` stays self-grantable as an *applicant* marker (become-driver flow); all driver capability is
    gated on verification. admin/super_admin cannot be self-granted (RPC whitelist + super-only policy).
- **App:** `activateAccount` no longer grants super_admin by hard-coded e-mail (production already has its 2
  super admins; nothing revoked); sign-up metadata can only yield `customer` / `driver` (applicant).
  Role-toggle MFA errors route to `/mfa`.
- **Tests:** `080_roles_and_visibility.test.sql` 26 assertions (self-grant admin/super, direct role insert,
  admin_grant_role by user/admin/super-without-MFA, applicant sees 0 open jobs / 0 RPC rows, verified driver
  sees them, re-verification overdue loses access, token rotation, old token dead, guessed token, other drivers
  lose access after acceptance, no delivery PIN on row, cancelled + 90-day expiry, recent receipt works).
  `060` adjusted: a pending driver's bid is now refused earlier (cannot see the job) — asserts "throws and no
  bid created". **DB 285/285, tsc clean.**
- **Side effect to note:** a tracking link shared by a customer *before* acceptance stops working at acceptance
  (the job page always shows the current link).
