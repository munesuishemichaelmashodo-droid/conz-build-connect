# ConZ — nationwide sourcing & dispatch: verified deployment sequence (11/10/2026)

Nothing here has been run against production. Every step needs the owner's go-ahead.
Live migration list read (read-only) on 11/10/2026: last recorded = `20261008045551 0076_admin_money_controls`.
`main` (eb288f1) already contains the hardened app (PR #6); whether Vercel has deployed it is **not verified**.

## Verified dependencies (from the files)

| Migration | Needs | Notes |
|---|---|---|
| 0077 KYC, 0079 roles/visibility, 0081 deletion, 0084 live-only objects | 0072–0076 live | app-independent |
| 0082 ledger | 0074 `post_ledger`, 0076 `append_only_guard` | |
| 0083 invariants | 0076 tables | |
| 0085 | 0074, 0076, **0082** | |
| 0086 | `admin_set_commission` | MFA on commission change |
| 0078 PIN lockout | app that reads jsonb result | main already has it |
| 0080 pricing integrity | app that calls `create_price_quote_for` | main already has it |
| 0087 sourcing table | — | **already live, unrecorded**; replay is a no-op |
| 0088 sourcing workflow | 0087, **0080** (`create_price_quote_for`), 0072 (`is_valid_money`) | cannot be applied before 0080 |
| 0089 geographic dispatch | live `accept_dispatch_offer` body (= 0053 + 0072), `driver_can_accept`, `hold_job_commission` | no migration 0077–0086 redefines these |
| 0090 sourcing booking radius | **0080** (base body), 0088 | fixes: customers could not book a sourcing quote |

## Sequence

1. Backup (no PITR on the Free plan). Re-read the live migration list; confirm nothing moved past 0076.
2. `0077 → 0079 → 0081 → 0082 → 0083 → 0084 → 0085 → 0086`, one at a time, md5-verify each against the file.
   Super-admin money actions need MFA from `0076` on: both super admins must enrol at `/mfa` (needs the main app deployed).
3. Confirm Vercel serves `main` (hardened app). Smoke: login, wallet, job page.
4. `0078`, then `0080`. Verify one priced test booking (quote created, `quote_id` on job, `consumed_at` set) and a wrong PIN.
5. Owner decision: record `0087` in migration history (only the record; no SQL effect on live).
6. `0088`, then `0090`, then `0089`. Run `select * from financial_reconciliation()` afterwards.
7. Deploy the feature-branch app (merge via PR). Safe if it lands before 0088: customers outside coverage get a
   controlled "couldn't record your sourcing request" error instead of a request; nothing else changes.
8. Operate: an admin must verify at least one supplier site per material region, and drivers must be
   `available` with a fresh position and a registered truck, or 0089 offers nobody (admins get a `dispatch_manual_needed` notification).

## Not changed (needs owner decision)

* Commission: hold/gate use the base rate, charge uses `rate x level multiplier` (`170_commission_level_multiplier`).
* Open-job feed and bidding are not location-restricted (verified drivers see/bid on every open job).
