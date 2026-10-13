# Owner decisions A and B (2026-10-12) — nothing implemented without approval

## Decision A: supplier stock — RESOLVED by owner direction (2026-10-12), implemented locally in 0101

Owner: ConZ is not an inventory marketplace. Customers say what they need; ConZ and the drivers find a practical way to
supply and deliver it. Stock records must never be the gatekeeper.

Implemented (local, uncommitted; migration `20261012330000_0101_stock_is_advisory.sql`, test 310):
- Blank (unknown) stock, and tracked stock lower than the request, no longer block candidate resolution, quote issuing,
  the booking-time supply check, or driver acceptance. Other eligibility is unchanged: verified supplier, active +
  verified + exact-coordinate location, material match, positive service radius, quote ownership/expiry/single use.
- `accept_bid` / `cancel_job` no longer decrement/restore stock (drivers may source elsewhere; decrementing would invent
  precision). Their remaining logic is untouched (sources were byte-identical to production before the patch).
- `supply_stock_status(location, qty)` returns `unknown` / `confirmed` / `below_requested` and never exposes quantities, so
  unknown is never presented as confirmed.
- 0098 bridge aligned to the same rule. 0080 (Stage B) re-adds a strict stock check, so 0101 MUST be applied right after
  0080.
- Old tests that encoded the stock gate (090, 140, 220, 280) were updated to the new rule; they are listed in the
  finalization status.

Also done (local): customer quote/booking screen shows an advisory label ("availability not yet confirmed" when stock
is unknown, never "available"); `job_supply_confirmations` + `confirm_job_supply` (0104) let the assigned driver or an
admin record that supply is secured, the customer sees "Supply confirmed" only after that. It is NOT a gate: it never
blocks the sourcing request, booking, start_trip or payment (product decision flagged: confirmation is informational).
Sourcing requests remain separate from driver-visible jobs.

## Decision B: diesel price and demand multiplier setters — APPROVED, implemented locally in 0103

Owner approved: both setters require super_admin plus fresh step-up. Implemented (local, uncommitted;
`20261012350000_0103_pricing_setters_superadmin_stepup.sql`, test 340, 23 assertions):

| Function | Who can call | Step-up | Audit | Bounds |
|---|---|---|---|---|
| `admin_set_diesel_price` | super_admin only | `require_aal2()` (fresh with 0096) | yes | >0 and <=100 |
| `admin_set_demand_multiplier` | super_admin only (was any admin) | `require_aal2()` (fresh with 0096) | yes | >0 and <=3 |

Consequences: a plain admin can no longer change the multiplier; accepted quotes/jobs are not rewritten; without 0096 the
step-up is aal2-only (no freshness window), so apply 0103 after 0096; super admins need an enrolled aal2 factor first.
The settings page shows a step-up prompt (`/mfa`) when the server demands it. No browser E2E of that prompt was run.

### Step-up enrollment prerequisites (checked in code; hosted settings NOT verified)
- Enrollment exists: `/mfa` (`src/routes/_authenticated/mfa.tsx`) enrolls a TOTP factor, challenges and verifies, and returns to a safe internal `next` path; `admin.settings` links there when the server answers `MFA_REQUIRED`.
- The database accepts only a fresh TOTP verification (0096 freshness via `amr`, default 15 min, `system_settings.admin_stepup.max_age_minutes`).
- 0061 (25/09) deleted all enrolled factors, so every super admin must enroll again BEFORE 0103 goes live.
- Not verified: that TOTP MFA is enabled in the hosted Supabase Auth settings (owner dashboard check), and no browser run of enroll → verify → save.
- Lockout recovery (nobody can change pricing): a super admin who loses their authenticator is unenrolled from the Supabase dashboard (Authentication → Users), then re-enrolls. Keep at least two enrolled super admins. This is a recovery procedure, not weakened security.
