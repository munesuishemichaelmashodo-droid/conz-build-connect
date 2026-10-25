# ConZ payments — implementation plan

Status: **waiting at the decision gate.** No step below starts until the founders approve
`ARCHITECTURE-DECISION.md` and answer its decisions. Steps 1–3 are configuration and testing of the existing
Paynow integration; no replacement provider is built unless step 3 fails and the fallback is chosen.

Each code step = one pull request: failing test first, smallest change, `npm run typecheck`, `npm test`,
`npm run lint:security`, `npm run build`, CI pgTAP green. No production migration without its file committed
in the same sitting (CLAUDE.md hard rule) and an undo script in `supabase/rollbacks/`.

| Step | Change | Files / systems | Who | Acceptance | Rollback |
| --- | --- | --- | --- | --- | --- |
| 0 | Decision gate | `ARCHITECTURE-DECISION.md` | Founders | Model, commission base, cancellation and unused-credit rules signed off in the doc | — |
| 1 | Confirm the Paynow account | Paynow merchant portal / support | Owner | Written answers to the Paynow enquiry; account name = Navysky Innovations or a transfer plan | — |
| 2 | Configure the reconcile backstop | Vercel env `PAYNOW_RECONCILE_SECRET`; `app_secrets` rows `paynow_reconcile_url`, `paynow_reconcile_secret` (same value) | Owner (secrets never in chat) | Blank POST to `/api/internal/paynow-reconcile` → 401; the 2 stuck payments get a `payment_events` row within 10 min | Remove the env var / rows |
| 3 | Prove Paynow end to end | Test mode on a preview deployment (security plan row 28), then $1 live (row 29) | Owner + Claude | Credited once, ledger line, callback row recorded | Mark the $1 as a test top-up; it stays in the owner's wallet |
| 4 | Small fixes found by the audit | Migration `0113_payment_hygiene`: set `payments.paid_at` on credit + backfill (P-4); store Paynow start error (P-5, app `paynow.functions.ts`); charge `held_commission` at settlement (P-6, after decision); pgTAP `440_payment_hygiene` | Claude | New tests fail before, pass after; full suite green | Undo script restores the three function bodies |
| 5 | Manual top-up form (fallback channel) | `src/routes/_authenticated/wallet.tsx`: method, amount, reference, calls existing `request_topup`; shows ConZ's receiving number/account from a setting | Claude | Driver submits; super admin approves in Revenue; wallet +amount once; duplicate reference refused | Hide the form |
| 6 | Callback tests in CI | `.github/workflows/verify-build.yml`: run `paynow-ipn-db.test.ts` against the pgTAP database | Claude | 9 tests run and pass in CI | Revert workflow change |
| 7 | Reconciliation state and weekly check | Admin Revenue screen: list `payment_events` anomalies; checklist for Paynow portal vs `payments` | Claude + owner | Anomalies visible without SQL; first weekly check logged | Hide the panel |
| 8 | Only if step 3 fails and the fallback is chosen | Second provider integration behind the same `apply_*_result` contract | Claude | Same security plan rows pass for the new provider | Feature switch off |

Out of scope until separately approved: escrow, withdrawals, payouts, split settlement, ZiG wallets.
