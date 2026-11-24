# Archived payment work

## Payonify — retired 24/11/2026 (owner decision)

ConZ is no longer pursuing Payonify: its geographic coverage does not meet ConZ's requirements.

| Item | State | Where it is kept |
| --- | --- | --- |
| Code, webhook, payouts, migrations 0167/0168 | Never merged to `main`, never applied to any production database | Branches `payments/payonify-merged`, `payments/payonify-relay`, `payments/payonify-review-fixes`, `payments/payonify-sandbox`, `stabilise/payments-migration-plan` (kept; do **not** merge). Optional for the owner: tag them `archive/…` and delete the branches |
| PR #38 | Closed (not merged) | GitHub |
| Migration plan | Moved here | `PAYONIFY-MIGRATION-PLAN.md` |
| Vercel Preview variables | Still present (owner removes): `PAYONIFY_SECRET_KEY`, `PAYONIFY_PUBLISHABLE_KEY`, `PAYONIFY_WEBHOOK_SECRET`, `PAYONIFY_PAYOUTS_SECRET`, `PAYONIFY_MODE`, `PAYONIFY_TESTER_USER_IDS`, plus the six Supabase variables scoped to branch `payments/payonify-relay` (including a `SUPABASE_SERVICE_ROLE_KEY`) | Vercel → Settings → Environment Variables |

What was reused: the provider-neutral ideas (idempotent events, payout hold/retry rules, test-mode allow-list) are re-implemented
without Payonify code in migration 0171 (`provider` payment method, `driver_payables`, `driver_payouts`).

**Paynow is not affected.** The Paynow commission-credit top-up (`paynow.functions.ts`, `/api/public/paynow-ipn`,
`apply_paynow_result`, cron `paynow-reconcile`) stays exactly as it is, for direct-pay jobs.

**Linkwa** remains a candidate only. Nothing is built against its API.
