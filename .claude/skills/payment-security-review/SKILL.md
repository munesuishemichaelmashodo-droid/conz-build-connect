---
name: payment-security-review
description: Use when reviewing or changing any ConZ code that moves or records money — callbacks, hashes, wallet/ledger functions, admin money actions, RLS on payment tables, grants on SECURITY DEFINER functions. Checks a fixed list of payment attack paths and requires a regression test per finding.
---

# Payment security review

## When to use
- A pull request touches `src/lib/paynow*`, `src/routes/api/**`, wallet screens, or SQL that writes
  `payments`, `wallets`, `wallet_transactions`, `platform_ledger`, `jobs.commission/held_commission`.
- Before switching on escrow, withdrawals or a new provider.

## Checklist (each item: pass / fail / not applicable, with the line or function)
1. Callback authenticity: provider hash/signature verified per the official algorithm, constant-time compare,
   duplicate field names rejected, verification before any database call.
2. Binding: reference must equal our payment id; amount and currency equal the stored payment; payment type
   decides the effect (top-up vs escrow); the stored user is credited, never a user named in the callback.
3. Idempotency: a second success, a late success after cancel, and a failure after success change nothing and
   are logged; row lock (`for update`) around every balance change.
4. State machine: only allowed transitions (see `docs/payments/FINANCIAL-STATE-MACHINE.md`).
5. No browser trust: return URLs and client-reported status never credit anything.
6. Server-side amounts: price, commission and top-up limits computed or re-checked in the database.
7. Grants: money functions are service_role-only or check role + step-up inside; no blanket grants
   (see CLAUDE.md 07/10 lesson); `search_path` pinned on SECURITY DEFINER functions.
8. RLS: users read only their own wallet rows; nobody updates balances directly; ledger tables immutable.
9. Admin controls: super admin + fresh step-up for credits; no self-credit; reason required; audit row written.
10. Secrets: integration key, reconcile secret and poll URLs never reach the browser or logs.
11. Reconciliation: every credit has one ledger entry; nightly reconciliation compares wallets to ledger.
12. Abuse: top-up rate limits and wallet cap enforced in the database.

## Evidence and tests
Each failure needs: realistic abuse scenario, smallest fix, and a failing-then-passing test
(pgTAP in `supabase/tests/database/` or Vitest in `tests/unit/`). Never weaken a check to pass a test.

## Output
Checklist table, then findings: severity (P0–P3) | location | scenario | fix | test | evidence class.
