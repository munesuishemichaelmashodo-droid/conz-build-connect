# Con Z — Staging & Paynow test-mode runbook (Phase 18)

**Status (08/10/2026): prepared, NOT created.** Creating the staging project needs an owner decision
(see "Blocker" below). Nothing here touches production.

## Blocker — owner decision required

The Supabase organisation is on the **Free plan (limit: 2 active projects)**. Active today:
`conz-build-connect` (production) and `venmax-admin`; `nyabadza-real-estate` is paused.
To create `conz-staging` the owner must choose one:

1. **Pause `venmax-admin`** while staging is in use (free), or
2. **Upgrade the org to Pro** (paid; also gives production daily backups + optional point-in-time recovery,
   which a live payments platform should have before applying migrations 0072–0084).

## 1. Create the staging project (owner)

- Supabase dashboard → New project → name `conz-staging`, region `eu-central-2` (same as production),
  strong DB password stored in a password manager.
- Auth: enable Email + Google (staging OAuth client with redirect `https://<staging-vercel-url>/oauth-callback`
  and `com.conz.app://oauth-callback`), enable **TOTP MFA**, enable leaked-password protection.

## 2. Build the schema (from git, never from production data)

```bash
# Link the CLI to STAGING only (never run db push without checking the ref)
npx supabase link --project-ref <STAGING_REF>
# The full history is not replayable (see CLAUDE.md drift notes): apply the
# baseline + later migrations exactly as scripts/db-test.mjs does:
node scripts/db-test.mjs start      # local sanity first; then for staging:
npx supabase db push --workdir .dbtest --db-url "postgresql://postgres:<PW>@db.<STAGING_REF>.supabase.co:5432/postgres"
```

`.dbtest/` contains the reference data and the **test-helper migration** — for staging, delete
`.dbtest/supabase/migrations/29991231235959_test_helpers.sql` before pushing (it disables the push trigger
and installs pgTAP helpers; staging should behave like production).

## 3. Secrets (staging values only — never production)

| Where | Name | Value |
|---|---|---|
| Vercel (staging env) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` | staging project |
| Vercel (staging env) | `SUPABASE_SERVICE_ROLE_KEY` | staging service role |
| Vercel (staging env) | `PAYNOW_INTEGRATION_ID`, `PAYNOW_INTEGRATION_KEY` | **separate Paynow integration in TEST mode** |
| Vercel (staging env) | `PAYNOW_RECONCILE_SECRET` | `openssl rand -hex 32` (new) |
| Staging DB `app_secrets` | `paynow_reconcile_url` = `https://<staging-url>/api/internal/paynow-reconcile`, `paynow_reconcile_secret` = same value | |
| Staging DB `app_secrets` | `push_hook_secret` | new random value; staging `send-push` deployed with the same |
| Staging Edge secrets | `SEND_SMS_HOOK_SECRET`, `AFRICASTALKING_*` (sandbox), `SMS_ALLOWED_COUNTRY_CODES=263` | |

Also change the hard-coded production URL in `tg_send_push_on_notification` on staging (it posts to
`ovwrsocjmkpiygipmrdk.supabase.co`) — or disable that trigger on staging.

## 4. Paynow test-mode checklist (no real money)

Paynow test mode only completes payments made from the integration's registered `authemail` with Paynow's
test phone numbers / cards. Run each and record the `payment_events` rows:

| # | Scenario | Expected |
|---|---|---|
| P1 | Wallet top-up $1, IPN delivered | `credited`, wallet +1, ledger paynow_topup |
| P2 | Same, with the IPN endpoint returning 503 (unset `PAYNOW_INTEGRATION_KEY` briefly) | reconcile job later `credited` exactly once |
| P3 | Replay the captured IPN body with curl | `duplicate_ignored` |
| P4 | Cancel at Paynow | `closed_unpaid` |
| P5 | Paynow "insufficient funds" test number | failed / `closed_unpaid`, no credit |
| P6 | Escrow pay for an accepted job | `escrow_marked_paid`, driver notified, nothing credited |
| P7 | Driver delivery photo + customer PIN → release | payout = amount − 7%, ledger escrow_released |
| P8 | Escrow paid, customer cancels | `refund_due`; refund in Paynow portal; super admin (MFA) marks refunded |
| P9 | Pay twice for one job | second → `refund_due` (duplicate_payment) |
| P10 | 6 wrong delivery PINs | locked; customer warned |
| P11 | Run `select * from financial_reconciliation()` after all of the above | every check ok |

## 5. Multi-connection race tests (not possible in single-session pgTAP)

- Two parallel `admin_wallet_adjust` debits by one admin straddling the daily cap → one must fail.
- Two parallel IPNs for the same payment → exactly one credit.
- Two parallel `accept_bid` on the same job → one wins.
Script with `psql` in two terminals or `pgbench -f` against **staging only**.
