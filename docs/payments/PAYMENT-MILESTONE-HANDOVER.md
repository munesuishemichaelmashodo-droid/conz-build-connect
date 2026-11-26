# Payment milestone: handover inventory (04/11/2026). Nothing here is started or changed.

## Live today
- **Paynow** is the live provider since 13/08 (driver wallet top-ups). Escrow ("Con Z Pay") is OFF, withdrawals are OFF, commission 7%, direct customer-to-driver payment is the default.
- Live money functions (migrations 0063, 0073-0076, 0093-0097 and later, function hashes checked 24/10-28/10): payment state machine, escrow refund lifecycle, admin money controls with Google step-up, withdrawal payout tracking and PIN recovery. Commission is reserved at acceptance and charged at completion by the live settle path; the first completed job is commission-free.

## Existing payment code
- `src/lib/paynow.server.ts`, `paynow.functions.ts`, `paynow.reconcile.server.ts`, `paymentErrors.ts`
- Routes: `src/routes/api/public/paynow-ipn.ts` (callback), `src/routes/api/internal/paynow-reconcile.ts` (needs a secret, not yet owner-configured)
- UI: `wallet.tsx` (top-up, balance buckets), `jobs.$id.tsx` (Con Z Pay pay/confirm), `admin.approvals.tsx` (money approvals)
- Tests: Paynow database and callback suites run in CI.

## Integrations and status
| Provider | Status |
|---|---|
| Paynow | Live for top-ups. BuySafe holds funds until delivery is confirmed; only verified merchants (3 months minimum) can disable it. |
| Payonify (EcoCash) | PR #38 (draft): client, webhook, switch, auto-payouts. Needs KYC, live keys, a company bank account, and a $1 live test. Test mode refuses the production database. |
| Pesepay | Not started; depends on merchant approval. |
| Paystack / Payoneer | Excluded by owner decision. |

## Unapplied payment-related migrations (do not apply without a separate approval)
| Migration | Purpose | Depends on |
|---|---|---|
| 0113 | Settle with the commission reserved at acceptance (fixes a charge-more-than-reserved case) | none |
| 0116 (PR #18) | Credit Paynow top-ups only when Paynow settles, not while BuySafe holds them | owner decision 6 in `ARCHITECTURE-DECISION.md` |
| 0120 / 0121 (PR #38) | Payonify charges, provider switch, driver auto-payouts | KYC, keys, webhook, bank account |
| 0134 | One-time $20 promotional commission credit | 0113 |
| 0129 | Admin launch-switch setter | none |

## Outstanding dependencies
- Merchant and KYC approval, live keys, company bank account, and a legal review of the escrow and deposit wording.
- Owner decisions: instant credit versus wait-for-settlement (#18), whether Paynow stays after Payonify, who holds the reconcile secret.
- Webhook URLs, Vercel Production variables, and the switch-over order in `docs/payments/PAYONIFY-MIGRATION-PLAN.md`.

## Security and reconciliation requirements (from the existing plans)
- Server-side amounts only; the payment row is written before any provider call; one open attempt per job and per top-up.
- Callback authenticity (signature or hash, freshness), amount, reference and currency checks, idempotency, and a state machine that never moves backwards.
- The provider result is applied in one database function; mismatches change nothing and alert admins.
- Money actions need super admin plus Google step-up plus a reason plus an audit row; ledger and wallet writes only inside SECURITY DEFINER functions.
- Scheduled reconciliation against the provider, with a documented manual refund and dispute path.
- Test order: unit, pgTAP, DB-backed callback tests, provider test mode, then the owner-run $1 live test. See `SECURITY-TEST-PLAN.md`, `FINANCIAL-STATE-MACHINE.md`, `IMPLEMENTATION-PLAN.md`.
