# ConZ — exact safe release order and owner go/no-go card (final, 12/10/2026)

Nothing here has been applied, committed, pushed or deployed. Database evidence comes from a local stand-in
(Postgres 16, not the real Supabase stack). This document authorises no production write, merge or deploy.
It supersedes the earlier stacked version of this file.

## Starting point (read-only facts)

Production's recorded history stops at 0076 (+ the 13/08 baseline); it also holds some unrecorded 0077-0087 objects
(see `CONZ-RECONCILIATION-0077-0097-2026-10-12.md`). Production lacks `create_price_quote_for`,
`verified_quote_supply_for_job`, the 0088 sourcing workflow, withdrawal payout functions and PIN-recovery. Its
`require_aal2` has no freshness window. All 15 supply locations have blank stock.
Never replay old migrations wholesale. Never `supabase db push`. Never hand-insert history rows.
Apply each file by its exact filename, one transaction per file.

## Exact order

| # | Migration (exact file) | Why here | App constraint |
|---|---|---|---|
| A1 | `20261012300000_0098_bridge_create_price_quote_for` | restores quoting (production fails closed today); blank stock is quotable | none, app already calls it |
| A2 | `20261012310000_0099_guard_photo_timestamps_and_sweep_proof` | stops delivery-photo clock backdating | none |
| A3 | `20261012320000_0100_fix_admin_set_diesel_price_audit_call` | diesel setter failed for everyone | none |
| B1 | 0078 | reconciliation | ship compatible app first |
| B2 | 0080 | strict stock versions re-created here | ship compatible app first |
| B3 | `20261012330000_0101_stock_is_advisory` | **immediately after 0080**: removes every stock gate 0080 re-adds | none |
| B4 | 0088 - 0097 in numeric order | sourcing workflow, dispatch, withdrawals, delivery proof, PIN recovery, step-up freshness (0096) | 0096: app that sends the delivery code to `complete_job` must be live first |
| B5 | `20261012340000_0102_decline_dispatch_offer` | needs 0089 | app degrades gracefully if absent |
| B6 | `20261012350000_0103_pricing_setters_superadmin_stepup` | needs 0096 for the freshness window (without it step-up is aal2-only) | admin.settings shows step-up prompts |
| B7 | `20261012360000_0104_job_supply_confirmation` | adds supplier-confirmation record (advisory, not a gate) | UI card calls it; absent = card fails soft |
| B8 | `20261012370000_0105_accept_dispatch_offer_lock_order` | needs 0089; fixes a parallel-accept deadlock | none |

Stage A (A1-A3) can go first on its own and is independent of Stage B (rehearsed on a production-like database lacking 0096).
Stage B must not start before the verified backup and restore below.

## Rehearsal evidence (stand-in, final tree, `scripts/ops/rehearse-release-order.sh`, base DB = 0076 history)

- Stage A: blank-stock site quotable.
- After 0080 alone: blank-stock quote rejected (the expected hazard; this is why 0101 must follow 0080 directly).
- After 0101: quotable. After 0088-0097 and 0102-0105: quotable.
- All 7 new/changed functions present; no stock gate in the 5 affected functions; no new function executable by anon;
  `create_price_quote_for` not client-callable. Result: REHEARSAL PASSED.
- Schema fingerprint of the rehearsed database equals the full-chain database (functions after whitespace normalisation, constraints,
  indexes, grants, columns, policies, triggers).
- Stand-in only. The rehearsal on a restored copy of real production is still to be done.

## After applying (each stage)

Run `run_financial_reconciliation`, smoke-test one blank-stock booking, one direct-pay and one escrow job end to end, a
sourcing request, a driver decline, then the Paynow $1 test from the runbook (needs your approval; not done).

## Go / no-go card

Release only if every box is true:
- [ ] Backup taken today exists in two places (`CONZ-BACKUP-RESTORE-PROCEDURE-2026-10-12.md`).
- [ ] It was restored into a SCRATCH project and counts matched. Not restored = not a backup.
- [ ] The order above was rehearsed on that restored copy and pgTAP passed there.
- [ ] You know the origin of the 18 unmatched production objects (reconciliation doc).
- [ ] Super-admin accounts can complete step-up (aal2 factor enrolled) BEFORE 0103, or nobody can change diesel/multiplier.
- [ ] You approved the exact files and a time window in writing.

If any box is false: stop. Production keeps running as it is today.
