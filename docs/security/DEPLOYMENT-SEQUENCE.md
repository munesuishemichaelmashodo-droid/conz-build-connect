# Con Z — Production deployment sequence (final)

Supersedes §9 of `CONZ-FINAL-READINESS-REPORT.md` (the earlier order was wrong in two places; see "Corrections").
Verified 08/10/2026: pgTAP **380/380** with migrations applied in THIS order (0078 and 0080 last).
Nothing below has been run. Every step needs the owner's go-ahead.

## Findings behind the order

| Question | Finding |
|---|---|
| Why did `0075` fail? | **Not a SQL error.** The apply tool returned "Invalid or expired requestState" before executing; production was verified unchanged (no record, no triggers, old policies intact). The SQL replays cleanly on a fresh DB, is covered by `040` (27 assertions), and its production prerequisites hold (client INSERT already revoked by 0066; the 4 policies it drops exist; the UI uses only the cancel/approve RPCs). Safe to re-apply. |
| Why did production quotes fail? | Production has **both** `create_price_quote` overloads → the app's 4-arg call is "not unique" and always failed (error swallowed). 16 quotes exist; **0 were ever consumed** (the trigger's `UPDATE` ran under the customer's role, no policy → silently 0 rows). 12 jobs carry a `quote_id` (earlier code), the recent ones don't. Fixed by `0080` + `booking.functions.ts` (server-created quotes bound to customer; definer helper for consume). Regression: `090` (24). Historical jobs untouched. |
| The 3 Paynow top-ups | See below. **No balance change is needed or proposed.** |
| Is the hardened app compatible with the CURRENT schema? | **Mostly, with two hazards:** (a) the new IPN/reconcile call `apply_paynow_result` — absent until `0073` → **IPN would 502 and nothing would credit** if the app went first; (b) new quote creation calls `create_price_quote_for` (from `0080`) — before 0080 it fails silently exactly like today (no regression). Account deletion shows "could not check" until `0081`. |
| Is the CURRENT app compatible with the new schema? | `0073`–`0075`, `0077`, `0079`, `0081`–`0084`: yes. **`0076`/`0085`/`0086` require MFA for super-admin money actions and the old app has no `/mfa` page** → super-admin approvals, refunds, credits, commission changes are blocked from DB step until the app is live and each super admin has enrolled. `0078` returns jsonb: the old app would show "success" on a wrong PIN → **must follow the app**. `0080` revokes client `create_price_quote` and makes quotes mandatory → old app can't book priced materials → **must follow the app**. |

### The 3 "uncredited" top-ups — findings (read-only)

The 12 paid top-ups: 8 have a `paynow_topup_credited` audit row. The 4 without are all **$1.00, 09/08/2026
16:09–16:53**: `e79c3ae8…`, `82217807…`, `23e91e02…`, `2d8b0213…` (the "3" in my earlier count was off by one).
For each: a matching wallet transaction **exists** — note `Paynow top-up (manual reconcile, payment <id>…)` created
at 16:56:44 the same day, one per payment, amount $1.00, and each payment has a Paynow reference. Conclusion: these
were paid at Paynow, then **credited by hand** (SQL fix on 09/08, the incident described in the IPN code comments)
which bypassed `credit_wallet_from_payment` and so wrote no audit row. Each is credited **exactly once**; wallets
reconcile with their transactions. **Finding for all four: benign historical manual reconciliation; no action.**
Optional owner check: confirm 4 × $1.00 on 09/08 in the Paynow merchant statement. Do not edit balances or
back-fill audit rows (the ledger is immutable by design).

## Sequence

**A. Before anything:** (1) merge-ready: owner approves *pushing* `security/hardening` (PR to `main`; CI will run
tsc, lint:security, 42 unit tests, build, and the pgTAP suite on GitHub). Vercel will build a preview — don't pay
through it. (2) **Backup** (Free plan has no PITR): Supabase dashboard → Database → Backups, or
`pg_dump` the project. (3) Check no drift: latest migration is still `20261007231311`.

**B. Database, app-independent set — one at a time, md5-verify each** (apply the exact committed file; after each,
compare `md5(replace(array_to_string(statements,''),E'\r',''))` in `schema_migrations` with the file, as done for 0072):

`0073 → 0074 → 0075 → 0076 → 0077 → 0079 → 0081 → 0082 → 0083 → 0084 → 0085 → 0086`

(dependencies: 0074 needs 0073; 0082/0083/0085 need 0074 + 0076; 0085 needs 0082.) Run `select * from
admin_reconciliation_report()` is unavailable until MFA — instead run `select * from financial_reconciliation()`
via the SQL tool (service context) after 0082: all checks must be `ok`. **Immediately continue to C** (super-admin
approvals are blocked in the gap; 3 manual top-ups are pending).

**C. Deploy the app** (merge PR → Vercel production). Smoke: login, wallet page loads, a $1 top-up by an
admin account credits once (`payment_events` shows `credited`), job page renders.

**D. Owner setup (≈10 min):** each of the 2 super admins opens `/mfa` and enrols an authenticator; set
`PAYNOW_RECONCILE_SECRET` in Vercel (`openssl rand -hex 32`) and the same value in `app_secrets`
(`paynow_reconcile_url`, `paynow_reconcile_secret`); confirm `SEND_SMS_HOOK_SECRET` is set, then
`supabase functions deploy send-sms --no-verify-jwt`.

**E. Database, app-dependent set:** `0078` then `0080`. Verify: place one test booking end-to-end (quote created,
job inserted with `quote_id`, quote `consumed_at` set); wrong withdrawal PIN returns "Wrong PIN" and
`pin_attempts.fail_count` increments.

**F. Final verification:** `admin_reconciliation_report()` (as super admin with MFA) all ok; `payment_events`
clean; then proceed to staging Paynow test mode before promoting escrow.

## Corrections to earlier documents

1. Earlier order put `0076/0085/0086` before the app "app-compatible" — they are DB-compatible but lock out
   super-admin money actions until MFA enrolment; the sequence above makes that window explicit and short.
2. `0083` depends on tables from `0076`; `0082` on `append_only_guard` (0076) and `post_ledger` (0074) — numeric
   order already satisfies this; do not reorder.
3. "3 uncredited top-ups" is **4**, all explained above.
