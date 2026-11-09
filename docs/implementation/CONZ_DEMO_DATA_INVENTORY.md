# Demo and test data: dry-run inventory (Stage 3, 09/11/2026)

**Read-only. Nothing was deleted, changed or created.** Aggregate counts only; no personal data recorded here.

## Is there a demo mode that can touch real data?
No. Searching `src/` for demo / sandbox / test-mode / fake finds only unrelated text (OSRM "demo server" comment, input-otp, a tour comment). There is no demo flag, demo route
or seeded demo user in the app. Test environments are separate by construction: the local sample-data stand-in (`scripts/dev/mock-supabase.mjs`, localhost) and the
`conz-staging` project (now paused). Neither is production.

## What production contains (query 09/11/2026)
| Item | Count |
| --- | --- |
| Users | 15 (8 Google, 6 email, 1 phone; 12 email-confirmed) |
| Users whose email looks like test/demo/example (patterns) | 0 |
| Users on reserved test domains (example/test/mailinator/.invalid) | 0 |
| Jobs | 94: 74 cancelled, 11 completed, 6 in progress, 2 open, 1 accepted |
| Open jobs older than 14 days | 0 |
| Bids | 52 |
| Payments | 44: 12 paid, 23 failed, 7 cancelled, 2 initiated |
| Driver profiles | 7 (5 verified) |
| Admin / super-admin roles | 5 |

## What this means
- Test-like accounts cannot be identified by address: the early test accounts appear to be the owner's own real addresses (CLAUDE.md notes the owner's name variants in test data).
  The spec says the two protected accounts must be known before any cleanup. **They are not named in the spec or docs. Owner must name them (owner-review #2).**
- 74 of 94 jobs are cancelled, most likely test churn from development. Cancelled jobs carry no live commission reservation; they affect metrics only.
  `admin_marketplace_metrics` (0150) should be read with that in mind.
- 12 paid payments: some may be real Paynow top-ups since go-live (13/08), some tests. Not distinguishable here; **do not delete or "clean" payments**.

## Proposed plan (needs owner approval; not executed)
1. Owner names the two protected emails and confirms which other accounts are tests.
2. Backup first (Supabase backup/point-in-time or a `pg_dump` of the affected tables).
3. Exclude tests from metrics with a flag column (additive, non-destructive) rather than deleting.
4. Deleting anything: only cancelled jobs with no payments/ledger rows, in a reviewed script, after 1-2.

# Pricing origin check (Stage 4, partial)
- `compute_material_offer` and `compute_transport_offer` contain no Harare/Pomona coordinates (V, live `prosrc` scan 09/11). Other "Harare" hits are time-zone names
  (`Africa/Harare`) and the `admin_supply_coverage` dashboard.
- `materialSource.functions.ts` states it must not fall back to Harare; the map picker's Harare start is only the initial map view.
- **Fixed (code only):** the admin settings text claimed an unset pickup "falls back to the default Harare point". That was stale and untrue; it now says no default is assumed.
- Still to do in Stage 4: dated and sourced competitor refresh; calibration report only if 10 jobs and 3 drivers per segment exist (production has 11 completed jobs in total, so
  almost certainly not met: the report will say so).
