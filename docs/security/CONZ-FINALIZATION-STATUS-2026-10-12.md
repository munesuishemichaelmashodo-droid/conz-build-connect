# ConZ finalization status (2026-10-12 evening)

Tree: branch `feature/nationwide-sourcing`, HEAD `390cc8d` + uncommitted 0098-0100, tests 280/290/300, docs, `scripts/ops/`,
and a modified `scripts/db-concurrency-check.sh` (added S9). Nothing committed, pushed, deployed or applied to production.
Environments: **stand-in** = local Postgres 16 (not the real Supabase stack); **prodlike** = stand-in built to mimic
production history; **prod read-only** = catalog queries only; **mock** = none used for money.

## Status by item

| # | Requirement | Status | Evidence / environment |
|---|---|---|---|
| 1 | Customer anywhere can submit a sourcing request | PASS | pgTAP 140 (idempotency, validation, rate limit), probe: Gweru request created; stand-in |
| 2 | Sourcing request invisible to drivers until booked | PASS | probe as driver: 0 requests, 0 jobs; 160 (one job only after customer books); stand-in |
| 3 | Match by location/distance/capacity/material/verification | PASS | 150, 220 (radius, capacity, verified, exact precision, status); stand-in |
| 4 | Nearby first, widen; no province wall | PASS | 150 stages 25/50/100 km, Bulawayo excluded by distance not province; 180 far driver (~370 km) can see and bid; stand-in |
| 5 | Progressive notifications, no duplicates | PASS | 150: wave 1 one driver, no repeat offer, widening after 3/6 min, ceiling; stand-in |
| 6 | Customer sees supplier, total price, confidence, estimate vs confirmed | NOT TESTED | UI wording not browser-tested; unknown stock must be labelled unknown (Decision A) |
| 7 | Driver bidding with job conditions and earnings | PASS (DB) / NOT TESTED (UI) | 180 bidding rules; stand-in |
| 8 | Two drivers cannot claim one job | PASS | concurrency S9 (2 parallel `accept_bid`: 1 accepted, 1 rejected, hold not doubled); `accept_dispatch_offer` locks the job row (sequential test in 150); stand-in |
| 9 | Routing down fails closed | PASS (earlier cycle) | unit tests / server function review; not re-run against live OSRM |
| 10 | Over 100 km flagged, not blocked | PASS | 180; stand-in |
| 11 | Backhaul preserved | PASS (DB) | new characterization test 330 (12 assertions): suggestions only for open jobs near the delivery point, never the current/assigned/far jobs, no state change, authorisation; stand-in |
| Fin | Paynow valid/invalid/duplicate/out-of-order callbacks | PASS | 020, 190, S1 (10 parallel IPNs credit once); stand-in, provider **mocked by calling `apply_paynow_result`**, no live Paynow |
| Fin | Flat 7%, first job free once | PASS | 170, 240, S8 (race: exactly one free) |
| Fin | Escrow, delivery proof, 72h | PASS | 030, 250, 290; S7 |
| Fin | Refund, cancel, dispute, duplicate refund | PASS | 190 (second refund refused), 030 |
| Fin | Withdrawals, reservation, failure, reversal | PASS | 200, 210, 230, 270; S2-S6 |
| Fin | Unauthorised financial ops | PASS | 050, 120, 260 (~30 client attacks blocked) |
| Fin | Ledger/provider/order mismatch detection | PASS | 110, nightly `run_financial_reconciliation` cron in production |
| 3 | Production RPC matrix | DONE | `CONZ-RPC-COMPATIBILITY-MATRIX-2026-10-12.md`: 7 missing, 1 signature difference |
| 3 | Safe migration order | DONE (rehearsed on prodlike) | release-order doc: Stage A (0098-0100) then Stage B (0077-0097) |
| 3 | Stock is advisory (owner direction 2026-10-12) | PASS (local) | 0101 + test 310 (24 assertions); unknown/low stock no longer blocks candidates, quotes, booking check or driver acceptance; `supply_stock_status` labels unknown; stand-in + prodlike + 0076 base apply cleanly. Customer-facing "stock not confirmed" wording NOT DONE |
| 3 | Diesel/multiplier step-up | OWNER DECISION | decision doc; recommend super admin + fresh step-up |
| 4 | tsc / vitest / build | PASS | clean / 17 files 149 tests / build passed, route checks 200 |
| 4 | Full pgTAP | PASS | 30 files, 841 assertions, 0 failed (stand-in) |
| 4 | Concurrency | PASS | S1-S9 all pass (stand-in) |
| 4 | `eslint src` | FAIL (pre-existing) | 1786 errors / 27 warnings, unchanged by this work |
| 4 | Real Supabase stack, CI, Android | NOT TESTED | not run this cycle |
| 4 | Browser E2E of UI | NOT TESTED | no browser run |
| Rel | Verified backup + isolated restore | BLOCKED | needs owner at a computer; Free plan has no backups |
| Rel | Origin of 18 unmatched production objects | BLOCKED | unexplained |

## Findings (new this cycle)

1. (FIXED locally, 0102 + test 320, 14 assertions; app Decline button now calls the RPC) **Driver "decline" was client-side only** (`JobOfferListener.tsx`: the Decline button just closes the dialog). No
   server decline exists, so a declined offer stays pending until its timeout, and widening waits for expiry. Product gap,
   not a security defect. Decision for owner: add a `decline_dispatch_offer` RPC (small forward migration + test) so
   declines widen the search immediately.
2. **Client calls to server-only functions** (`claim_super_admin`, `expire_stale_*`) fail by design; cron covers expiry
   (stale open jobs now up to 30 min). See RPC matrix.
3. **Stock rule flips between Stage A and Stage B** (see Decision A).
4. Backhaul has no regression test.

## Release checklist (order)
1. Owner decides stock rule and multiplier policy.
2. Verified backup, restored into an isolated scratch project, integrity checks pass.
3. Owner approves committing named files; CI on the real Supabase stack.
4. Stage A (0098-0100), smoke test booking.
5. Stock quantities entered (if rule = reject) then Stage B in documented order; app version that sends the delivery code only after Stage B.
6. Smoke tests; sandbox Paynow test before live money.

## Status
Locally implementation-complete: yes, except items marked NOT TESTED (UI wording, backhaul test, driver decline RPC).
Production-release-ready: **no** (backup/restore, owner decisions, approvals, real-stack run outstanding).

## Update: stock-is-advisory change (this cycle)
Files: `supabase/migrations/20261012330000_0101_stock_is_advisory.sql`, `20261012340000_0102_decline_dispatch_offer.sql`,
edited `20261012300000_0098_bridge_create_price_quote_for.sql` (stock rule aligned); tests `310`, `320`, `330` (new) and
`090`, `140`, `220`, `280` (updated: they asserted the old stock gate); app: `admin.sourcing.tsx`, `sourcing.functions.ts`,
`materialSource.functions.ts`, `booking.functions.ts`, `JobOfferListener.tsx`.
Final stand-in results on this tree: full rebuild of 85 migrations OK; pgTAP 33 files / 891 assertions / 0 failed;
concurrency S1-S9 pass; tsc clean; vitest 17 files / 149 tests; build passes; `eslint src` 1786 errors / 27 warnings
(identical to baseline).

## FINAL UPDATE (final tree, evening 12/10/2026) — supersedes counts above

Tree: branch `feature/nationwide-sourcing`, HEAD `390cc8d`, everything below uncommitted. Environment of every result: stand-in
Postgres 16 (NOT the real Supabase stack) unless stated.

| Check | Result |
|---|---|
| Full rebuild from scratch (baseline + 88 files) | BUILD OK (88 migrations) |
| pgTAP full suite | 35 files / 937 assertions / 0 failed / 0 SQL errors |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | 18 files passed + 1 skipped; 154 passed, 9 skipped |
| DB-backed Paynow IPN test (env vars set, provider mocked) | 9/9 pass |
| `npm run build` | passed, routes /auth, /customer/book, /become-driver 200 |
| `npx eslint src` | 1786 errors / 27 warnings (identical to baseline; pre-existing) |
| Concurrency S1-S13 (fresh `conc_check`) | all pass (S12/S13 added later; S1-S11 earlier on identical code) |
| Release-order rehearsal (base = 0076 history) | PASSED; schema equals full chain |
| Parallel duplicate refund (S12) + release-vs-refund race (S13) | PASS (stand-in, 3 runs) |
| Browser/Android E2E, real Supabase stack, CI, Paynow sandbox/live | NOT TESTED |

New since the previous update: 0103 (super-admin + step-up on diesel and multiplier; owner approved), 0104 (supplier confirmation,
advisory only), 0105 (accept_dispatch_offer deadlock fix), tests 340/350, customer advisory stock label, `SupplyConfirmationCard`,
admin step-up prompt, DB-backed Paynow test, concurrency S9-S11, rehearsal and schema fingerprint scripts.

Changed paths — modified: `scripts/db-concurrency-check.sh`, `src/components/JobOfferListener.tsx`, `src/lib/booking.functions.ts`,
`src/lib/materialSource.functions.ts`, `src/lib/sourcing.functions.ts`, `src/routes/_authenticated/{admin.settings,admin.sourcing,customer.book,jobs.$id}.tsx`,
tests 090, 140, 220. New: migrations 0098-0105 (`supabase/migrations/20261012300000`…`370000`), tests 280-350,
`src/components/SupplyConfirmationCard.tsx`, `src/lib/stockStatus.ts`, `tests/unit/{paynow-ipn-db,stockStatus}.test.ts`,
`scripts/ops/`, and the docs in this folder (release order, decisions, RPC matrix, drift classification, payment readiness, others).

Outstanding blockers: verified backup + isolated restore (owner at a computer); 18 unexplained production objects; rehearsal on a
restored production copy; real-stack/CI run; browser E2E of the new UI; Paynow sandbox then $1 test (needs approval);
super-admin aal2 enrollment before 0103; leaked-password protection and `pg_net` schema (older open items).
Product notes: supplier confirmation does not gate start_trip/payment; client expiry sweeps are no-ops (≤30 min latency).

Release readiness: locally implementation-complete: yes. Production-release-ready: **NO**.
Next required action: owner takes and restores a backup into a scratch project, then approves named files for commit.

## Update 2 (21:00, brief "Final Completion, Recovery Verification & Production Readiness")
- Only `scripts/db-concurrency-check.sh` changed since the results above (S12, S13 added); no application or migration change, so the other results above remain valid for this tree.
- Device link: BLOCKED. Two attempts to reach the owner's computer failed ("not connected to the bridge"). Therefore NOT verified: the Windows repo state, the safety copy `ConZ-safety-20261012-204749`, Docker images/containers, disk space, any earlier dump file, the `supabase_db_conz-dbtest` container.
- This cloud workspace holds a copy of the tree (branch `feature/nationwide-sourcing`, HEAD `390cc8d`, 12 modified + 31 untracked). It does not contain the `.pre-final-sourcing` / `.pre-sourcing-backup` files (they are on the Windows side). A patch plus archive of all uncommitted work was sent to the owner as a safety copy.
- Backup/restore: BLOCKED (no computer, no authorised production credentials in this session, none requested in chat). No dump was attempted over SQL: a row export through a query tool is neither binary-safe nor appropriate for customer data in a cloud sandbox. Lowest-data next step in `CONZ-BACKUP-RESTORE-PROCEDURE-2026-10-12.md` (run on the owner's computer; `pg_dump -Fc` straight to a file, then `pg_restore --list` and a restore into the local test container).
- Step-up prerequisites documented in the decisions doc (enrollment UI exists; hosted TOTP setting not verified; all super admins must re-enroll before 0103).
- Decision: locally implementation-complete; production-release-ready NO.
