# ConZ money-flow audit — 12/10/2026 (local stand-in, no production access used for writes)

Tested commit base: `390cc8d` + uncommitted 0098, 0099, tests 280/290. Database results are from the
local stand-in (Postgres 16, not the real Supabase stack) and are NOT a production verification.

## Verified defect (fixed locally, not applied anywhere)

**D1 — a driver could backdate the delivery-photo clock and trigger an instant escrow auto-release.**
- Where: `public.jobs_guard_direct_write()` (driver branch never checks `pickup_photo_taken_at` /
  `delivery_photo_taken_at`; the customer branch does) + `public.auto_release_escrow_payments()`
  (releases when `delivery_photo_taken_at < now() - 72h`, no open dispute, escrow paid).
- Reproduction (driver acting alone through the client API): `record_job_evidence(... 'delivery' ...)`, then
  `update jobs set delivery_photo_taken_at = now() - interval '80 hours'` succeeded, then one sweep
  completed the job, credited the driver $279 and booked commission, with no customer delivery code and
  no 72-hour dispute window. Test 290 failed 7 of 12 assertions before the fix.
- Fix: migration `0099_guard_photo_timestamps_and_sweep_proof` — new trigger `jobs_guard_photo_times`
  (only the system or an admin may change those two timestamps) and the sweep now also requires a real
  delivery evidence row from the job's driver (inline, no dependency on 0096). Applies cleanly on the
  production-like database that lacks 0096. Test 290: 12/12 after.
- Exposure in production: the same weakness exists there today (the guard and sweep are older code).

**D2 — the diesel-price setter could never succeed.**
- Where: `public.admin_set_diesel_price(numeric)` ends with
  `log_admin_action('diesel_price_changed', NULL, NULL, jsonb_build_object(...), NULL)`, but the signature is
  `(_action text, _meta jsonb, _reason text, _target_id uuid, _target_user uuid)`: the jsonb lands in a uuid
  parameter, so every call (even a super admin's) fails with SQLSTATE 42883 and nothing is changed.
- Evidence: reproduced on the stand-in (test 300 failed 4 of 8 before the fix); production's function text was
  checked read-only (catalog query, no data) and contains the same call; `log_admin_action` has the same signature there.
- Fix: migration `0100_fix_admin_set_diesel_price_audit_call` (named arguments; auth, bounds, upsert unchanged;
  NULL price now rejected with the bounds message). Test 300: 8/8 after. Applies cleanly on the production-like DB.
- Impact: the owner cannot adjust the diesel price (a pricing input) from the admin screen until applied.

## Checked and found correct (probed with real calls on the stand-in)
- Flat 7% for every level; first completed job free, once; 2nd job 7% (escrow and direct), held
  commission released, platform_revenue ledger -21 for a $300 job.
- Escrow: duplicate IPN/poll ignored; amount mismatch / reference mismatch rejected; late success after
  close flagged; cancel after payment -> refund_due (no wallet credit); mark-refunded twice harmless.
- Top-up: duplicate callbacks credit once.
- Withdrawals: over-available refused (held counted), one pending at a time, reservation held and
  released on failed payout, no double reversal, paid payout cannot be failed, no double debit.
- Admin money controls (stand-in): only a super admin with fresh step-up can credit; credits over $100 need a
  second super admin (self-approval refused, double approval refused); no self-targeting; negative balances
  refused; a transaction can be reversed once; plain admins can only debit within their cap; top-ups: negative
  amounts and duplicate references refused, only a super admin approves, a second approval credits once, an
  approved top-up cannot be rejected; every action lands in admin_money_actions / admin_audit_log.
- Client privilege attacks (30 attempts: price/commission/status/held/payment_method/driver_id edits,
  direct wallet/ledger/payment writes, calling settlement and ledger functions, evidence forgery,
  first_job_free_used/level reset): all refused.

## Potential risks (not verified as exploitable)
- `admin_set_demand_multiplier` (scales every enforced material price, 0 < x <= 3) is allowed for any admin
  without step-up, while commission and diesel need super_admin (and commission needs step-up). It is audited
  and bounded, so it is a policy question for the owner rather than a defect: decide whether it should be
  super_admin + step-up like the other pricing/commission controls.
- `jobs.pricing_breakdown`, `quote_id`, `supply_location_id`, `pricing_version` are not in the customer
  or driver guard lists; budget changes are re-validated by the pricing trigger, so no price bypass found,
  but a customer could alter the displayed source on an open job.
- Escrow commission is reserved from the driver's wallet at acceptance even though it is later taken
  from the payout; a zero-balance driver may be unable to accept escrow jobs after the free first job.
  Product decision, not a defect.
- Auto-release after 72h pays without the customer code by design (0096 header); the dispute window is
  the control, now no longer bypassable by the driver.
- Reconciliation reported not-ok on seeded test data only because the test helpers fund wallets
  without ledger rows (helper artifact).
- Paynow code (`paynow.server.ts`, IPN route) re-read: hash verification, constant-time compare, host
  allowlist and DB-side idempotency are sound.
