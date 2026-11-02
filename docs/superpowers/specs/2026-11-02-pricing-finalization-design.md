# Pricing finalization (engine v1.4) — design

Date: 02/11/2026. Branch `pricing/finalize-v14` from `main` 0d437eb. Brief:
`CONZ_Pricing_System_Finalization_Prompt.txt` (owner, 02/11/2026).

## Intent (owner)
Credible estimates that help a customer post a job and don't put drivers into loss-making jobs. One pricing
engine (`compute_material_offer`), no payment/commission changes, nothing live without approval.

## Verified state (read-only, production `ovwrsocjmkpiygipmrdk`, 02/11/2026)
- Live `compute_material_offer` body = git 0118 (md5 4b23d1de…, v1.3); recorded 20261026130000.
- `system_settings`: `diesel_price_per_liter` = 1.87 (21/07/2026), `commission_rate` = 7; no
  `fuel_l_per_100km` / `long_haul_markup` rows (engine defaults 32 and 1.87 apply).
- Material prices 13/08/2026, buckets = per-m³ × size, all multipliers 1.0; small loads enabled (0.1 m³ min).

## Owner decisions (02/11/2026)
1. Diesel: **$2.04/L** (ZERA ceiling from 09/10/2026) is the value and the single fallback.
2. Orders over 20 m³: **20 m³ truckloads** (trips = ceil(qty / 20)); removes the jump at 20.01 m³.
3. Fuel use and long-haul allowance: **editable** in Admin → Settings (audited setters).
4. Low end of the range **includes delivery**.

## Confirmed defects → fixes (migration 0127, one file + rollback + pgTAP 590)
| # | Defect | Fix |
|---|---|---|
| D1 | Diesel fallbacks disagree: engine 2.04, admin screen 1.87, driver form "not set" | One fallback 2.04 everywhere; quote `assumptions` already name the source (`setting`/`default`) |
| D2 | Large loads learn from accepted bids (incl. cancelled/unfinished), ≥3 samples, mean, no distance | Only `completed` jobs with `final_price > 0`, quantity > 0, one row per job, ≥10 jobs and ≥3 distinct drivers, **median** per m³, and saved road distance within ±50% (or both ≤ 10 km) when `pricing_breakdown.distanceKm` exists; else the deterministic reference calculation |
| D3 | 20 m³ = 1 trip, 20.01 m³ = 3 trips (10 m³ reference) | Reference capacity 20 m³ for > 20 m³; transport × ceil(qty/20) |
| D4 | `admin_price_accuracy` counts accepted/in-progress as results | Return both: `customer_accepted` (accepted/in_progress/completed) and `completed_delivery` (completed only), with sample counts; card labels them; advice only from completed |
| D5 | Fuel/long-haul settings unreachable | `admin_set_fuel_assumptions(_fuel_l_per_100km, _long_haul_markup, _reason)`: super admin + `require_aal2()`, bounds (fuel 10–80, markup 1–3), reason ≥ 5 chars, one audit row, atomic; SECURITY DEFINER, `search_path` pinned, EXECUTE authenticated only |
| D6 | Low end = bucket minimum, without delivery | `low` = bucket min + transport (still ≤ recommended) |

Unchanged: commission (7%, cent rounding, first job free), payment flow, stock as advisory, open-request guide
(10/40/120 km, labelled indicative), small-load branch except the shared diesel/fuel values, material prices.

## App
- `admin.settings.tsx`: diesel fallback 2.04; new card for fuel use + long-haul allowance (step-up, reason).
- `jobs.$id.tsx` / `driver-economics.ts`: fuel estimate uses the same fallbacks as the engine and says when a
  default is used (never "not set" while the engine prices).
- `PriceAccuracyCard`: two rows (customer accepted vs completed delivery), counts shown.
No new tables, no second calculator, no new services.

## Owner actions (not done by code)
Set diesel to $2.04 in Admin → Settings (the migration changes only the fallback, not the saved 1.87).

## Tests
pgTAP 590: quantity/distance boundaries (0.5, 1, 5, 10, 12, 15, 20, 20.01, 25, 30 m³; 10/20/30/50 km ± 0.01),
history qualification (cancelled/active/zero price excluded, 10 jobs, 3 drivers, median vs outlier, distance),
no double transport, low ≥ bucket min + transport, setter permissions (customer/driver/admin refused, super admin
without step-up refused, bounds, audit row), direct writes still refused (0125). Existing 490 updated only where
D3/D6 intentionally change values. Unit tests for driver fuel fallback and accuracy card labels.
Full run: typecheck, unit, lint:security, build, full pgTAP on a fresh local stack.

## Release
PR to `main`; deploy app first, then 0127 (no DROP), then owner sets diesel. Undo: rollback file restores 0118
`compute_material_offer` and 0123 `admin_price_accuracy` exactly and drops nothing else in use.
