# Con Z — Second Security Audit (Phase 19)

**Date:** 08/10/2026 · **Branch:** `security/hardening` (local, not pushed) · **Scope:** final code on the branch +
the database built from git (baseline + migrations through `0086`) on a fresh local Supabase (Postgres 17),
plus read-only introspection of production for comparison.

> **Production is NOT patched.** Nothing in this audit has been applied to production. Every "FIXED" below
> means: fixed in git and proven by tests on a fresh database. Until the deployment in
> `CONZ-FINAL-READINESS-REPORT.md` §9 is carried out, every original finding is still live in production.

**Method.** Re-derived each original finding from the current function/policy definitions (not from the first
audit's text); attacked each fix through the client roles (`authenticated` / `anon` with PostgREST-style JWT
claims) and `service_role`; added schema-wide invariant tests; compared every trigger, policy and constraint
between production and a fresh database built from git; then searched for new holes, especially ones introduced
by this programme. **Test evidence:** 13 pgTAP files, **380/380 assertions pass**; Vitest **42/42**; `tsc` 0
errors; build + compiled-server smoke test pass.

---

## 1. Original findings

| ID | Original finding | Fix (migration / code) | Evidence (test) | Status |
|---|---|---|---|---|
| **F1** CRIT | Money minting via negative / NaN / ±Infinity bid or budget; NaN wallet balances | `0072` `is_valid_money`, range CHECKs on every money column (NaN/±Inf excluded), re-validation in every price→balance RPC; commission ∈ [0, price] | `010` (39): attacks reproduced pre-fix (16 failures), refused post-fix; end-to-end mint refused, balance unchanged | **FIXED** |
| **F2** HIGH | Paid escrow stranded on cancel / expiry / dispute | `0074` `refund_due → refunded` lifecycle, `escrow_refunds` queue, cancel / 24 h expiry / dispute-refund / late / duplicate payments all route to refund; super_admin+MFA confirms Paynow refund | `030` (54): every path, double release/refund, release-after-refund, refund-after-release, ledger invariants | **FIXED** |
| **F3** HIGH | Paynow status regression, replay, no amount/reference check, refunds not debited | `0073` state machine (all roles), `apply_paynow_result` (reference + amount + state, single credit, anomalies flagged), poll URL hidden from clients; `paynow.server.ts` constant-time hash, duplicate-field rejection, host allowlist, signed initiate response | `020` (43) + unit `paynow.server.test.ts` (16) | **FIXED** (refund/chargeback *clawback* is a flagged human decision by design) |
| **F4** HIGH | Pending withdrawal/top-up rewritable after PIN check | `0075` guard trigger (all roles), admin direct-update policies dropped | `040` (27) | **FIXED** |
| **F5** HIGH | Admin self-credit / unlimited credits | `0076` `admin_money_guard` (no self-target, credits super_admin + MFA, daily caps not splittable, 2-person above $100), top-up approval super+MFA; `0085` closes two more admin-credit paths (below) | `050` (45), `130` (16) | **FIXED** |
| **F6** HIGH | KYC editable after verification; docs overwritable | `0077` identity/document change → back to pending + admin alert; storage overwrite/delete frozen once verified; bucket limits | `060` (20) | **FIXED** |
| **F7** MED | Withdrawal-PIN lockout bypass (change-PIN oracle) | `0078` counted, shared, return-not-raise PIN checks; 5→15 min, 10+→24 h | `070` (31) | **FIXED** (and see N1) |
| **F8** MED | Role escalation; open-job/tracking exposure; forged audit; SMS fail-open; open redirect; demo functions; incomplete deletion | `0079` verified-only open-job access + token rotation/expiry + MFA for privileged grants; `0076` audit log locked; `send-sms` fail-closed (git); `safeInternalPath`; PKCE native OAuth; `0081` deletion | `080` (26), `100` (18), unit tests (24) | **FIXED in code** · demo functions **NOT removed** (needs approval) · SMS/OAuth **not deployed / not device-tested** |
| **F9** MED | Paynow/IPN operations, escrow reconciliation, ledger | `0073` server-side reconcile (cron → secret-gated route), `SITE_URL` → `www` (no 308 on IPN), `0074`/`0082` double-entry ledger for every flow, daily reconciliation | `020`, `110` (24) | **FIXED in code** · reconcile job **inert until secrets are set** |
| P (MED) | Client-controlled pricing inputs / route distance / supply location / preferred driver | `0080` server-only quotes, server pickup, quote binding, coordinate sanity, verified preferred driver | `090` (24) | **FIXED** |

## 2. New findings during the programme (not in the first audit)

| ID | Sev | Finding | Status |
|---|---|---|---|
| N1 | **HIGH** | **PIN lockouts never engaged**: `request_withdrawal` and `driver_confirm_delivery_pin` incremented the failure counter then RAISED, rolling it back. A driver could brute-force the customer's 6-digit escrow delivery PIN. (The 04/10 remediation report had marked it fixed.) Proven by test (`fail_count` stayed 0). | **FIXED** `0078`, `070` |
| N2 | HIGH (functional/pricing) | `create_price_quote` overload ambiguity — **every** quote creation failed silently; live jobs priced from a client-supplied pickup. Quote "consumption" was a silent no-op under RLS (reusable). | **FIXED** `0080`, `090` |
| N3 | HIGH (fidelity) | Production objects never committed to git: **`wallet_transactions_immutable`** (ledger immutability), `storage_evidence_guard`, chat-media / job-proof storage policies. A rebuild from git would have lost them. | **FIXED** `0084` (idempotent) |
| N4 | MED | anon held INSERT/UPDATE/DELETE on `payments`, UPDATE on request tables; authenticated held writes on `payments` (RLS-blocked, one policy away from exposure) | **FIXED** `0083`, `120` |
| N5 | MED | `admin_referral_action('release')` let **any admin credit a wallet — including their own referral — and release fraud-frozen rewards** | **FIXED** `0085`, `130` |
| N6 | MED | `resolve_dispute('refund')` on direct-pay jobs credited wallets for ordinary admins (no MFA/cap) | **FIXED** `0085`, `130` |
| N7 | MED | Commission-rate changes (affect every payout) needed only a password session | **FIXED** `0086`, `130` |
| N8 | LOW | `notify_kyc_reverification`, `account_deletion_blockers` callable for other users' ids (notification spam / activity leak) | **FIXED** `0083` |

## 3. Issues introduced by this programme — found and fixed in this audit

| Introduced in | Issue | Fixed in |
|---|---|---|
| `0082` | `financial_reconciliation()` callable by every signed-in user — exposed platform money totals and user / payment ids | `0085` (server-only; `admin_reconciliation_report()` for super admins) |
| `0080` (draft) | budget trigger `FOR UPDATE` on `price_quotes` failed under the customer's role | fixed before commit (definer helpers) |
| `0081` (draft) | scrubbing a NOT NULL column aborted deletion | fixed before commit |

Re-review of every privileged function this programme added that clients can call:
`is_verified_driver`, `price_quote_for_job`, `consume_price_quote` (own quote only), `admin_money_setting` (limits,
non-sensitive), `require_aal2`, the PIN RPCs, the admin money / approval RPCs (role + MFA + self checks),
`account_deletion_blockers` and `notify_kyc_reverification` (self only after `0083`). No further issues found.

## 4. Attack classes re-tested

- **Financial manipulation:** negative / zero / NaN / ±Infinity / overflow on every money input; negative-commission
  mint; NaN wallet withdrawals — blocked (`010`, `120`).
- **Replay / out-of-order / duplicate payment events:** blocked (`020`, `030`, unit).
- **State-machine bypass:** direct status updates as `service_role` rejected (`020`, `030`).
- **Authorization bypass / privilege escalation:** self-grant admin, direct role insert, admin self-credit, admin
  dispute/referral self-dealing, ordinary-admin credits, MFA bypass — blocked (`050`, `080`, `130`).
- **RLS failures:** schema-wide invariants (`120`); cross-user reads of KYC docs, payments' poll URL,
  reconciliation, ledger — blocked.
- **Brute force:** withdrawal PIN, change-PIN oracle, delivery PIN — locked (`070`).
- **Race conditions:** structural mitigations only (row locks, per-admin advisory lock, unique reversal index,
  state-machine trigger). **Not tested with concurrent sessions** — staging runbook §5.
- **Secrets / service-role misuse:** service-role key only in `*.server.ts` / server functions (unchanged); new
  reconcile route requires a ≥32-char secret (constant-time); no secrets added to git (`.env*` ignored).

## 5. Remaining risks (honest list)

1. **Production still vulnerable** until migrations `0072`–`0086` and the app are deployed.
2. **Not verified end-to-end:** real Paynow message formats (staging test mode), native Google sign-in on a device,
   Auth admin calls in account deletion (ban / global sign-out), `send-sms` deployment, GitHub Actions run.
3. **Concurrency** not tested with multiple sessions.
4. **Owner actions required:** super admins must enrol MFA before approving/crediting/refunding; set reconcile
   secrets; confirm `SEND_SMS_HOOK_SECRET`; approve removal of `quick-responder` (uses the owner's ORS key for anyone
   with the public key) and `smooth-handler`.
5. **Not addressed (lower severity, from the first audit):** rate limiting on public server functions (M7), CSP
   (L7), self-declared truck capacity / plate visibility (M13), client GPS plausibility (M14), `pg_net` in the
   public schema, leaked-password protection off, Free plan without point-in-time recovery.
6. **Historical data:** 3 of 12 paid Paynow top-ups have no `paynow_topup_credited` audit entry (wallets still
   reconcile with their transactions) — verify against Paynow statements.
7. **Lint debt** outside the security-critical files (~1.7k, mostly formatting) — not gated.

## 6. Verdict

**Security ready for staging: YES** — all original CRITICAL/HIGH findings and the new HIGH findings are fixed in git
and covered by passing tests on a fresh database. **Production: NO** — nothing is deployed, and the staging Paynow
test-mode run, device OAuth test and multi-session race tests have not happened.
