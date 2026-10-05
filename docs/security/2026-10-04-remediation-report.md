# Con Z — Security Remediation Report (P0 + listed P1)

**Date:** 04/10/2026 · **Branch:** `claude/conz-production-security-audit-0trp9m` · **DB:** `ovwrsocjmkpiygipmrdk` (changes applied live, the pre-launch environment; each `.sql` committed the same sitting).
**Goal:** move Con Z from NOT READY → READY FOR STAGING SECURITY TESTING. **Production readiness is NOT claimed.**

Migrations added (live + git + schema_migrations): `0066`–`0070`. Drift (`0063`–`0065`) reconciled by merging the live-aligned branch. Build + typecheck pass; lint is pre-existing formatting/`any` debt only.

## Re-audit table

| Finding | Previous | Fix applied | Verification | New status |
|---|---|---|---|---|
| **C1** escrow PIN readable by driver | NOT FIXED | 0067: PIN moved to `job_delivery_pins` (customer-only RLS, no client write); `jobs.delivery_pin` forced NULL; CSPRNG; 5-attempt lockout; idempotent confirm; anon EXECUTE revoked; customer reads via `get_my_delivery_pin`; frontend rewired | [LIVE] 0 plaintext rows; pin-table policy present; driver has no read path; anon can't call either RPC | **FIXED** |
| **C2** driver KYC self-grant | NOT FIXED | 0066: BEFORE INSERT guard forces pending/bronze/zeroed/first_job_free=false; client DELETE revoked (UPDATE already guarded) | [LIVE] behavioral test as a non-admin user: DELETE → `permission denied`; INSERT forced to defaults | **FIXED** |
| **C3** forged counter-offer job hijack | NOT FIXED | 0066: BEFORE INSERT guard forces status=pending, counter_status=none, customer_counter_price=null (UPDATE already blocked these) | [LIVE] trigger present; `accept_counter` now cannot see a client-forged counter | **FIXED** |
| **C4** unauthenticated push spoofing | NOT FIXED | 0069: `app_secrets.push_hook_secret` (service_role-only); trigger sends `x-conz-push-secret`; function v7 rejects mismatches (constant-time) 401 | [LIVE] trigger sends header; secret not client-readable; function source requires it. Live HTTP 401 **NOT VERIFIED** (sandbox egress to supabase.co blocked) | **FIXED** (HTTP black-box pending on staging) |
| **H1** fake jobs / rating manipulation | NOT FIXED | 0066: jobs BEFORE INSERT guard forces open/unassigned/no-outcome columns; ratings policy ties `driver_id` to the job | [LIVE] trigger present; ratings WITH CHECK contains the driver tie | **FIXED** |
| **H2** self-lifted suspension | NOT FIXED | 0066: profiles INSERT+UPDATE guards lock status/restrictions/strikes/ratings/deleted_at/referral_code/email | [LIVE] both triggers present | **FIXED** |
| **H3** withdrawal validation bypass | NOT FIXED | 0066: client INSERT on `wallet_withdrawal_requests`/`wallet_topup_requests` revoked (RPCs remain). 0068: approval checks held funds + limited + no self-approve; PIN change needs current PIN | [LIVE] auth INSERT = false; approval body checks present | **FIXED** |
| **H4** admin wallet self-minting | NOT FIXED | 0068: `admin_credit_wallet` → super_admin only, no self-credit, reason required, non-negative; approvals/verification block self-target | [LIVE] function bodies contain the checks | **FIXED** |
| **H5** escrow method-flip | NOT FIXED | 0066: `payment_method` frozen in jobs UPDATE guard. 0063 (live) + consolidated app fix: escrow only for accepted/in_progress; double-pay reconcile | [LIVE] `payment_method` in guard body | **FIXED** |
| **H10** dispute spoofing | NOT FIXED | 0066: client INSERT on `disputes` revoked (`raise_dispute` remains) | [LIVE] auth INSERT = false | **FIXED** |
| **H11** super-admin email bootstrap | NOT FIXED | consolidated app fix: requires `email_confirmed_at` | [CODE] `account.functions.ts` | **FIXED** |
| **H6** Paynow regression/replay/refund | NOT FIXED | partial: double-pay reconcile + escrow-status fix consolidated/live (0063). Status-regression `.eq('status','initiated')` guard and refund-debit path **not yet done** | — | **PARTIALLY FIXED** (P1 remainder) |
| **H7** referral farming | NOT FIXED | Closed transitively: depended on C2 (fake verified drivers), now blocked. Server-signal hardening deferred | [LIVE] via C2 | **PARTIALLY FIXED** |
| **H8** native OAuth token interception | NOT FIXED | Not changed here — App Links work exists on `web-app-routing-audit` branch | — | **NOT FIXED** (P1) |
| **H9** SMS hook fail-open | NOT VERIFIED | Not changed — confirm `SEND_SMS_HOOK_SECRET` is set in Edge secrets | — | **NOT VERIFIED** (P1 config) |
| **M2** definer views anon-readable | NOT FIXED | 0070: anon revoked on `driver_public_profiles`; all client access revoked on `market_rate_history` | [LIVE] anon SELECT = false | **FIXED** |
| **M9** Paynow key logging | NOT FIXED | consolidated app fix: logging removed | [CODE] `paynow.server.ts` | **FIXED** |
| **L3** anon write grants on money tables | NOT FIXED | 0070: anon INSERT/UPDATE/DELETE revoked on wallets + wallet_transactions | [LIVE] anon = false | **FIXED** |
| **M12** migration drift (0063–0065) | open | merged consolidation branch; 0063–0070 now in git + schema_migrations | [LIVE] versions present | **FIXED** |
| tsc errors (3) | failing | merge regenerated types + vite fix; relocated C1 query conditions | [RUN] `tsc --noEmit` exit 0 | **FIXED** |

**Still open (not in this pass):** H6 (status-regression guard + refunds), H8 (OAuth App Links), H9 (confirm SMS secret), and the P2/P3 set (M1 pricing coordinate validation, M3/M4/M5/M6/M7/M10/M11/M13/M14/M15, L-items). Super-admin MFA re-enable remains recommended before production.

## New-issue review (changes reviewed adversarially)
- All guards early-return for non-`authenticated`/`anon` roles, so service-role and SECURITY DEFINER RPC write paths are unchanged (verified: withdrawals via `request_withdrawal`, topups via Paynow/`request_topup`, profile create via service role, bid/job accept via definer RPCs, `set_withdrawal_pin` hash insert via definer).
- `set_withdrawal_pin`: 2-arg (real) + 1-arg (safe delegator passing null); frontend always sends both keys → no PostgREST ambiguity; neither overload can change an existing PIN without the current one.
- `job_delivery_pins`: customer-only read; driver read returns nothing; `jobs.delivery_pin` kept (always NULL) so `select('*')` and generated types are intact.
- No over-tightening found: bidder-card ratings still readable by authenticated; public quote/material reads unchanged.

## Verdict
**Is Con Z safe to move into controlled staging security testing? → YES**, with the staging sequence below run first, and with H6/H8/H9 + MFA tracked before any production decision.

### Staging test sequence (run on a staging copy, not production)
1. Replay §12 audit tests T-SEC-01..10, T-ADM-01..03, T-PAY-01 as the attacker roles — all must now fail closed.
2. Black-box C4: `POST /functions/v1/send-push` with no / wrong `x-conz-push-secret` → expect 401; with a real notification insert → push still delivered.
3. Regression happy-paths: customer signup→post job→bid→counter→accept→escrow pay→driver delivery photo→customer reads PIN→driver confirm→payout; direct-pay complete; withdrawal request→admin approve; driver KYC submit→admin verify.
4. Confirm `SEND_SMS_HOOK_SECRET` set (H9); decide on H6 status-guard + H8 App Links before production.

<!-- deploy trigger: TanStack CVE-2026-102989 patch is in this commit and later; build the latest commit, not ae9de90. -->
