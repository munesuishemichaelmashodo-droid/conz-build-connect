# Pricing finalization (engine v1.4) — design, revision 2

Date: 02/11/2026. Branch `pricing/finalize-v14` from `main` 0d437eb. Brief: owner's
`CONZ_Pricing_System_Finalization_Prompt.txt`; revision requested by the owner on 02/11/2026.
Status: **awaiting owner approval — no implementation yet.**

## Intent
Credible estimates that help a customer post a job without putting drivers into loss-making jobs. One engine
(`compute_material_offer`); no change to payments, the 7% commission, cent rounding or first-job-free; nothing
applied to production and no production data changed without the owner's explicit approval.

## Verified facts (read-only, production `ovwrsocjmkpiygipmrdk`, 02/11/2026)
- Engine: live body = git 0118 (md5 `4b23d1de…`, v1.3), recorded `20261026130000`.
- Settings: `diesel_price_per_liter` = **1.87** (21/07/2026); `commission_rate` = 7; no `fuel_l_per_100km` or
  `long_haul_markup` rows, so the engine uses its defaults 32 and 1.87.
- Trucks: `trucks.capacity_m3` (numeric). 5 trucks registered: 1, 8, 12, 16 and 20 m³.
- A driver's real trips are known only when they offer: `tg_stamp_bid_capacity` sets
  `bids.capacity_m3_snapshot` = truck capacity and `bids.estimated_trips` = ceil(quantity / capacity). The customer
  estimate is made before any truck is chosen.
- Jobs: `status` (job_status: open, accepted, in_progress, completed, cancelled), `final_price`, `quantity_m3`,
  `delivered_quantity_m3`, `material`, `driver_id`, `pricing_breakdown` (all 32 saved breakdowns contain
  `distance_km`, `distance_source`, `trip_count`, `low`, `recommended`, `high`). Disputes: `disputes.job_id`,
  `status` (live values: resolved, rejected). No test-account flag exists.
- Today: 11 completed jobs; the large-load history branch has never qualified.
- Security building blocks exist: `has_role(uid,'super_admin')`, `require_aal2()` (accepts a Google sign-in from
  the last 12 h on an account with a Google identity, else an aal2 session with a second factor from the last
  15 min), and `log_admin_action(_action, _meta, _reason, …)` writing `admin_audit_log`. `admin_set_diesel_price`
  already uses all three.
- Booking: `tg_validate_job_budget` rejects a budget outside the engine's `min`–`max` and saves the breakdown.
  Driver offers are not limited by that range (only by `max_job_budget` = $500, 0107).

## Decisions

### 1. Truck capacity / trips (corrected)
- **Driver side stays exact:** each offer's trips come from the driver's own registered truck (existing trigger and
  `tripsFor()` in the offer form). Nothing is hard-coded per driver.
- **Customer estimate** (no truck known yet) uses one documented reference load for *all* quantities:
  `trips = ceil(quantity / 20)`. 20 m³ is the largest load in the price table and a registered truck size.
  For ≤ 20 m³ this is 1 trip, exactly as today, so no existing quote changes. Over 20 m³: 20.01, 25 and 30 m³ are
  2 trips (today 3, 3 and 3 under the 10 m³ reference, with a jump at 20.01).
- **Limitation:** 4 of the 5 registered trucks are smaller than 20 m³, so for big orders a small-truck driver's
  offer can be higher than the estimate. The quote's assumptions say "assumes loads of up to 20 m³; a smaller
  truck needs more trips and the driver's offer includes that". No fleet average is used (5 trucks is too few and
  would make prices move whenever a truck is added).
- Tests: 20, 20.01, 25, 30 m³ (trips 1, 2, 2, 2) and the ≤ 20 m³ buckets unchanged.

### 2. Diesel (corrected)
- Production stays at **$1.87/L**. No migration, script or default writes `diesel_price_per_liter`. Changing it
  is a separate owner action in Admin → Settings.
- One fallback, **$2.04/L**, used only when the setting is missing or invalid (null, not a number, ≤ 0 or > 100),
  exactly as the engine already does. The quote's `assumptions.dieselSource` says `setting` or `default`.
- App made to match: the Settings card shows the saved value, or "Not set — the engine uses $2.04" (today it
  silently shows 1.87). The driver's fuel estimate uses the same value the engine would use and says when it is the
  default (today it says "No diesel price is set"). The same rule applies to fuel use (default 32 L/100 km, valid
  10–80) and the long-haul allowance (default 1.87, valid 1–3).

### 3. Historical benchmark for loads over 20 m³ (corrected)
A job counts only if all hold:
- `jobs.status = 'completed'`; `final_price > 0`; `quantity_m3 > 0`; same `material`; not `custom`;
- if `delivered_quantity_m3` is set, it is within 10% of `quantity_m3` (else not comparable);
- no dispute on the job except ones with status `rejected` (resolved disputes may have changed what was paid);
- quantity within ±30% of the request; completed within the last 6 months;
- distance comparable: `pricing_breakdown.distance_source` is a road distance (not `haversine`) and its
  `distance_km` is within ±50% of the requested distance, or both are ≤ 10 km.
- One row per job (the job's own `final_price`, not bids), so a job can't be counted twice; driver identity is
  `jobs.driver_id`.
- Use only if **≥ 10 jobs and ≥ 3 distinct drivers**; estimate = **median** price per m³ × quantity (all-in, no
  transport added), range ±15%, `dataSource: completed_jobs`, `sampleSize`, `driverCount`.
- Otherwise the deterministic calculation: mid material price per m³ × quantity + transport fee × trips
  (rule 1), range ±15%, `dataSource: reference_capacity`. A thin history never blocks a booking.
- Limitation: test jobs can't be told apart (no flag); today there are only 11 completed jobs, so the history
  branch cannot qualify yet.

### 4. Settings security (verified)
New `admin_set_fuel_assumptions(_fuel_l_per_100km, _long_haul_markup, _reason)` copies `admin_set_diesel_price`:
`has_role(auth.uid(),'super_admin')` → `require_aal2()` → bounds → reason ≥ 5 characters → both upserts in one
transaction → `log_admin_action('fuel_assumptions_changed', meta, reason)`. SECURITY DEFINER with
`search_path` pinned; EXECUTE revoked from PUBLIC/anon, granted to authenticated (the role check is inside). Google
re-sign-in is already how `require_aal2()` is satisfied (0111); no new provider, no weaker rule. Direct writes stay
refused (0125).

### 5. Lowest allowed budget (corrected)
- Bucket loads (1–20 m³): `low = least(bucket minimum + transport fee, recommended)`. The transport fee is the
  same single fee already inside `recommended` (material midpoint + transport), so it is counted once; `least()`
  keeps low ≤ recommended after rounding. `high` unchanged.
- Small loads (< 1 m³) and loads over 20 m³ already use ±15% around an all-in figure: unchanged.
- Impact on estimates: e.g. river sand 12 m³ at 15 km: low $144 → $174, recommended $200 and high $230 unchanged.
  Budgets default to the recommended price, so normal bookings are unaffected; a customer who types a budget
  between the old and new low is now refused with the existing "outside the allowed range" message.
- Impact on driver offers: none (offers aren't limited by the range). `raise_job_budget` still caps at `high`.
  Existing jobs are not re-validated.

### 6. Accuracy report
`admin_price_accuracy` returns both views: customer-accepted (accepted/in_progress/completed) and completed
deliveries only, each with counts and medians; advice only from completed jobs, from 5 per material.

## Changes (only where needed)
- **Migration 0127** (`20261102100000_0127_pricing_engine_v14.sql`, no DROP): `compute_material_offer` (rules 1, 3,
  5 + assumption text), `admin_price_accuracy` (rule 6), `admin_set_fuel_assumptions` (rule 4).
  **Rollback** restores the 0118 / 0123 bodies exactly and revokes the new setter.
- App: `admin.settings.tsx` (diesel display, fuel card), `driver-economics.ts` + `jobs.$id.tsx` (shared
  defaults), `PriceAccuracyCard.tsx` (two views), `booking.functions.ts` (reference capacity default 20).
- No new tables, no second calculator, no new services.

## Tests
- pgTAP 590: 0.5, 1, 5, 10, 12, 15, 20, 20.01, 25, 30 m³; 10/20/30/50 km and just above; history inclusion and
  exclusion (cancelled, active, zero price, delivered-quantity mismatch, disputed vs rejected dispute, haversine
  distance, far distance), 10 jobs / 3 drivers, median vs one outlier, no double transport, low ≤ recommended,
  low = bucket min + transport; setter: customer/driver/admin refused, super admin without step-up refused,
  bounds, reason, audit row; diesel setting untouched; direct writes refused. Existing 490 updated only where rules
  1 and 5 intentionally change values.
- Unit: diesel/fuel fallback display, driver fuel estimate with default, accuracy labels.
- Full run before review: typecheck, unit, lint:security, build, full pgTAP on a fresh local stack; browser
  check on the local sample-data stand-in at 360/390 px.

## Release
Feature branch and PR only. Deploy order after approval: app first, then 0127. No production data change.
Changing diesel to $2.04 is a separate owner decision.

## Unresolved risks
1. Estimates for orders over 20 m³ assume 20 m³ loads; most registered trucks are smaller.
2. No test-account flag: test jobs could count once completed jobs reach the thresholds.
3. Diesel stays $1.87 while ZERA is $2.04, so delivery fees remain thin until the owner changes it.
4. Raising the low end may refuse a few customer-typed low budgets (by design).
