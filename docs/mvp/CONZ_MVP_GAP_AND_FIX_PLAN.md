# ConZ MVP gap and fix plan (Option A), 05/11/2026

Priority order: P0 financial correctness and security → P1 marketplace journey → P2 wallet and top-up reliability → P3 admin and reconciliation → P4 Android/mobile → P5 documentation.

## Done in this stage (no financial or database change)
| # | Item | Where |
|---|---|---|
| 1 | Company TIN 2002683072 added to Terms and Privacy (company no. 145174A02102026 already there) | PR "Terms and Privacy: add the company's ZIMRA TIN" |
| 2 | The optional-deposit control was visible in production but its columns (0135) do not exist, so enabling it would fail on send. Hidden until 0135 is live | PR "Offer form: hide the optional deposit control…" (11 lines) |
| 3 | 0113 reviewed (below) | this document |

## 0113, reviewed (not applied; owner approval needed)
- **Defect confirmed in production:** the live `settle_direct_pay_job` has hash `c9f46993…`, identical to the "before" body in `supabase/rollbacks/20261025100000_0113_rollback.sql`. It recomputes 7% from the price and the rate at completion, not from `jobs.held_commission`. Effect: if a super admin changes the rate, or an admin edits a price, while a job is active, the driver is charged something other than what was reserved and the balance can go negative. Local reproduction in pgTAP 440 (6 of 24 checks failed before the fix).
- **Replacement:** body hash `6b7fecb8…`; same signature, return type and grants (service_role only). Only the amount changes: free first job still $0; a recorded reserve > 0 is charged exactly; no reserve recorded → 7% of the accepted price (legacy, unchanged); reserved-as-free but the free job was used meanwhile → 7%. Release, ledger, wallet and completion logic are untouched; the driver profile row lock serialises completions, so the free benefit cannot be given twice.
- **Compatibility:** the live "before" hash equals the rollback body, so the file was written against the real production definition. No DROP. Depends on nothing unapplied.
- **Tests and rollback:** pgTAP 440 (24 checks) and the existing 240/250 suites pass in CI; the undo script restores the exact live body.
- **Business impact:** on today's data nothing changes (rate and prices stable). It matters when the rate changes, or when a price is edited after acceptance. This is the Option A rule ("capture what was reserved"), so I recommend applying it. **Approval needed. Not applied.**

## Plan
### P0 Financial correctness and security
- Apply **0113** (above), after owner approval. Verify afterwards: live hash = `6b7fecb8…`, pgTAP-style probe in a rolled-back transaction.
- **0116 / PR #18 decision:** credit Paynow top-ups when Paynow settles, not while BuySafe holds the money. Current behaviour credits at "Awaiting Delivery"; a driver could spend credit ConZ has not received. Choose: apply 0116 (safer, slower for drivers) or keep instant credit and accept dispute risk. Needs the owner.
- Confirm `PAYNOW_RECONCILE_SECRET` is set in Vercel Production and that the 10-minute reconcile job runs; otherwise stuck top-ups are not repaired automatically.
- Keep promotional credit (0134), points (0131) and withdrawals off.

### P1 Marketplace journey
- Run the pilot test plan on real devices: photo upload, trip start, wrong code, completion (see pilot plan, to be written once P0 is approved).
- Decide the future of optional deposits: apply 0135 (additive; contains `DROP TRIGGER IF EXISTS` on its own object, so apply from the SQL editor) or leave the control hidden. Deposits stay direct between customer and driver; ConZ does not collect or guarantee them.
- Ask the three drivers without a push subscription to enable notifications.

### P2 Wallet and top-up reliability
- Add a driver-facing line in the wallet that states reserved versus available credit (already shown in the summary; confirm wording on a device).
- Run a duplicate-callback simulation against the staging copy, not production (needs a staging project; the paused one cannot be restored on the Free plan without pausing another).
- Confirm top-up minimum/maximum limits and the manual-top-up SOP.

### P3 Admin and reconciliation
- One admin view answering: commission earned, commission reserved, available credit per driver, pending and failed top-ups, jobs that generated commission, released or disputed reservations, items needing reconciliation, and who made each adjustment. The data exists (`wallet_transactions`, `platform_ledger`, `admin_reconciliation_report`, `admin_audit_log`); what is missing is one read-only report. It needs a read-only function (a migration), so it waits for approval and a design review.

### P4 Android and mobile
- Real-device regression on one customer and one driver Android phone after P0/P1.

### P5 Documentation
- This pair of documents is stage 1. The remaining six (financial operations, top-up SOP, admin guide, pilot test plan, launch readiness, known issues and rollback) are written next, describing only what is implemented after the approved changes.

## Owner approvals needed now
1. Apply 0113 (recommended).
2. Decide 0116 / PR #18.
3. Confirm the Paynow reconcile secret is configured.
4. Decide 0135 (apply, or leave deposits hidden).
5. Approve merging the two small PRs (TIN, deposit control) and this documentation.
