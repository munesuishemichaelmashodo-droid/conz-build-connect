# Con Z — Final Readiness Report

**Date:** 08/10/2026 · **Branch:** `security/hardening` (local, **not pushed**) · Companion documents:
`CONZ-HARDENING-PLAN.md` (phase log, owner decisions), `CONZ-SECOND-AUDIT.md` (finding-by-finding evidence),
`STAGING-RUNBOOK.md`, `../play/PLAY-STORE-READINESS.md`.

## Verdict

| Gate | Verdict | Evidence / reason |
|---|---|---|
| **APPLICATION BUILD READY** | **YES** | `tsc --noEmit` 0 errors · `npm run build` + compiled-server smoke test pass (Windows and Linux path) · Vitest 42/42 · `lint:security` 0 errors. Caveat: full-repo lint still carries ~1.7k historical (mostly formatting) errors, not gated. |
| **SECURITY READY FOR STAGING** | **YES** | All original CRITICAL/HIGH findings + new HIGH findings fixed in git; pgTAP **380/380** on a fresh local Supabase; second audit found and fixed 4 more issues. |
| **PAYNOW TEST READY** | **NO** | No staging project (Free plan limit) and no Paynow **test-mode** credentials. Paynow code is verified only against the documented message format. |
| **PRODUCTION READY** | **NO** | Only `0072` is live. `0073`–`0086` + the app are not deployed; staging Paynow run, device OAuth test and multi-session race tests not done; super admins must enrol MFA. |
| **GOOGLE PLAY READY** | **NO** | No signed AAB (needs owner key + JDK/Android SDK), no device test, App Links not configured, Data Safety / listing not submitted. |

## 1. Architecture (unchanged shape)

Browser / Android WebView → TanStack Start on Vercel (server functions, Paynow IPN, new secret-gated reconcile
route; service-role key server-only) → Supabase Postgres (RLS + guard triggers + SECURITY DEFINER RPCs + pg_cron)
→ wallets / jobs / escrow / **new double-entry `platform_ledger`**. Paynow is the only payment processor.

## 2. Security findings and fixes

See `CONZ-SECOND-AUDIT.md` §1–3. Summary: F1 (money minting) · F2 (stranded escrow) · F3 (Paynow regression /
replay / amount) · F4 (mutable payout requests) · F5 (admin self-credit) · F6 (KYC after approval) · F7 (PIN) ·
F8 (roles, tracking, audit forgery, SMS, open redirect, OAuth, deletion) · F9 (reconciliation, ledger) · pricing
inputs — **all fixed in git with tests**. New: N1 PIN lockouts never engaged (escrow PIN brute force, HIGH) · N2
quote path dead / reusable quotes · N3 production-only immutability trigger missing from git · N4–N8 admin-credit
side doors and over-broad grants — **all fixed**.

## 3. Database migrations (all in `supabase/migrations/`)

| # | Purpose | Live? |
|---|---|---|
| 0072 | financial numeric integrity (F1) | **YES** (`20261007231311`, md5-verified) |
| 0073 | payment state machine, `apply_paynow_result`, reconcile support | no |
| 0074 | escrow refund lifecycle, `platform_ledger`, `require_aal2` | no |
| 0075 | immutable withdrawal / top-up requests | no (apply attempt failed cleanly — nothing applied) |
| 0076 | admin money controls, MFA, caps, two-person credits, audit lock | no |
| 0077 | KYC re-verification, driver-docs storage freeze, bucket limits | no |
| 0078 | PIN lockouts that count (return-not-raise) | no — **needs app first** |
| 0079 | verified-only open jobs, tracking token rotation, MFA for role grants | no |
| 0080 | server-only quotes, server pickup, coordinate sanity | no — **needs app first** |
| 0081 | account deletion functions | no |
| 0082 | full ledger postings + daily reconciliation | no |
| 0083 | leftover grants revoked | no |
| 0084 | commit production-only objects (idempotent, no-op live) | no |
| 0085 | second-audit fixes (reconciliation leak, dispute/referral credits) | no |
| 0086 | MFA for commission changes | no |

## 4. Tests

- **pgTAP (13 files, 380 assertions):** `010` numeric 39 · `020` payments 43 · `030` escrow 54 · `040` requests 27 ·
  `050` admin money 45 · `060` KYC 20 · `070` PIN 31 · `080` roles/visibility 26 · `090` pricing 24 ·
  `100` deletion 18 · `110` ledger 24 · `120` invariants 13 · `130` second audit 16. Run:
  `node scripts/db-test.mjs start && node scripts/db-test.mjs test` (Docker).
- **Vitest (5 files, 42):** Paynow hash/verify/IPN, redirect validator, RPC result reader, SMS webhook verify,
  native OAuth callback parser. Run: `npm test`.
- **CI:** `.github/workflows/verify-build.yml` now runs typecheck, security lint, unit tests, build and the full
  pgTAP suite (fresh local Supabase in the runner). **Not yet executed** — runs when the branch is pushed.

## 5. Paynow / escrow / ledger status

- **Paynow:** every result goes through `apply_paynow_result` (reference + amount + state checked; single credit;
  no regression; anomalies alerted). IPN `resultUrl` now `https://www.conz.co.zw` (no 308). Server-side reconcile
  every 10 min — **inert until secrets are set**. Initiate response is now hash-verified (as the official SDKs do).
- **Escrow:** paid → released, or paid → refund_due → refunded (super admin + MFA after refunding in the Paynow
  portal). No path strands money; nothing is converted into withdrawable wallet money.
- **Ledger:** every flow posts balanced entries; daily reconciliation (9 checks) alerts super admins and never
  auto-fixes. Live preview: clean. Historical: 3 of 12 paid top-ups lack the credited audit entry (wallets still
  reconcile) — check against Paynow statements.

## 6. Android / Google Play

Manifest/backups/network/FileProvider hardened, env-based release signing, PKCE native OAuth. Owner steps in
`PLAY-STORE-READINESS.md` (keystore, AAB, App Links, Data Safety, listing). Not built here (no JDK/SDK).

## 7. Staging

Runbook ready. **Blocked:** Free plan allows 2 active projects (both used) → pause `venmax-admin` or upgrade
(also gives backups/PITR); separate Paynow test integration needed.

## 8. Production blockers / remaining risks

1. Branch not pushed → `0072` is live but its file is only on this machine (**drift risk for other sessions**).
2. `0073`–`0086` and the app not deployed (all original findings except F1 still live in production).
3. No backup/PITR on the Free plan — take a manual backup before deploying.
4. Super admins must enrol MFA right after the app deploy, or top-up/withdrawal approvals, refunds, credits and
   commission changes are blocked (fail-safe).
5. Unverified end-to-end: real Paynow formats, device Google sign-in, Auth admin calls in deletion, `send-sms`
   deploy, multi-session races.
6. Owner actions: reconcile secrets, `SEND_SMS_HOOK_SECRET`, delete demo functions (`quick-responder` spends the
   owner's ORS quota for anyone with the public key).
7. Lower-severity items not addressed: rate limiting (M7), CSP (L7), truck/GPS plausibility (M13/M14), leaked-
   password protection, `pg_net` in public.

## 9. Exact production deployment steps (each needs owner approval)

0. **Push** `security/hardening`, open a PR to `main`, let CI pass. (Vercel builds a preview — preview uses
   production env vars; acceptable, but don't use it for payments.)
1. **Backup:** Supabase dashboard → Database → Backups (or `pg_dump`) — Free plan has no PITR.
2. **DB, app-compatible set, in this order:** `0073 0074 0075 0076 0077 0079 0081 0082 0083 0084 0085 0086`
   (the currently deployed app keeps working: IPN still credits through the same RPCs; only super-admin money
   actions wait for MFA). Verify each with the statement-md5 check used for 0072.
3. **Deploy the app:** merge the PR to `main` (Vercel production).
4. **DB, app-dependent set:** `0080` (mandatory server quotes), `0078` (PIN result format).
5. **Owner config:** both super admins enrol MFA at `/mfa`; set `PAYNOW_RECONCILE_SECRET` (Vercel) +
   `app_secrets.paynow_reconcile_url/secret`; confirm `SEND_SMS_HOOK_SECRET` then `supabase functions deploy send-sms
   --no-verify-jwt`; approve deletion of `quick-responder` / `smooth-handler`.
6. **Verify:** `select * from admin_reconciliation_report()` (all ok), a $1 test top-up from an admin account,
   one booking end-to-end, IPN log, `payment_events`.
7. Then staging Paynow test mode (runbook) before announcing escrow / Play Store release.

## 10. Confirmation of production actions

- **Production database:** exactly **one** change — migration `0072_financial_numeric_integrity` (constraints +
  function hardening). One further apply attempt (`0075`) failed before execution and was verified to have changed
  nothing. All other production access was read-only (schema introspection and aggregate counts).
- **No** deploys, **no** branch pushes, **no** Edge Function changes, **no** secrets created or changed, **no**
  payments initiated, **no** data modified or deleted, **no** Paynow configuration touched.
