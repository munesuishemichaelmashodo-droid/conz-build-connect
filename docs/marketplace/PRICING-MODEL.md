# ConZ pricing and driver economics — how it works today (26/10/2026)

Evidence: live function definitions and settings read from production (read-only), and the
code on `pricing/engine-audit`. One engine: `compute_material_offer` (v1.2 live; v1.3
prepared in 0118). No second calculator exists or was added.

## 1. Where every number comes from

| Input | Where it comes from | Kind | Notes |
| --- | --- | --- | --- |
| Material price per m³ | `material_prices` (min/max, `demand_multiplier`) | Configurable (super admin) | National per material. Last updated **13/08/2026**. |
| Price per load size (5–20 m³) | `material_price_buckets` | Configurable | Last updated **17/08/2026**. |
| Supplier's own price | `material_supply_locations.price_override_*` | **Missing** | Columns exist; 0 of 13 locations have a value; the engine never reads them. |
| Supplier stock | `available_quantity_m3` | **Missing** | 0 of 13 have a value; advisory only (0101). |
| Pickup point | Nearest verified supply location for the material | Data | 3 of 13 locations have an exact pin; 10 are approximate and not used for pricing. None → open request. |
| Distance | Road route (OSRM) pickup → delivery | Computed | Straight-line fallback refused (`assertRoadDistance`). Booking trigger re-checks the quote's distance against the straight line (0.95×–3×). |
| Transport ≤ 50 km | Flat bands: ≤10 km $20, ≤20 $30, ≤30 $40, ≤50 $60 | **Hard-coded** | All-in (includes the empty return, per 0106). |
| Transport > 50 km | $60 + (km − 50) × fuel L/km × diesel × 1.87 | Mixed | Diesel: setting `diesel_price_per_liter` = **$1.87** (21/07/2026). Fuel 32 L/100 km and the 1.87 return-trip factor: **hard-coded** (0118 makes them optional settings). |
| Load size / trips | ≤ 20 m³ one trip (bucket); > 20 m³ ceil(qty / 10 m³ reference truck) | Hard-coded assumption | The customer quote assumes a 10 m³ truck; the driver's offer uses their real truck (`tg_stamp_bid_capacity`). |
| Small loads (< 1 m³) | `small_load_settings.minimum_trip_charge` | Configurable | |
| Large loads with history | Average accepted offer per m³ (≥ 3 similar jobs, 6 months) | Computed | **Bug, fixed in 0118:** transport was added on top of an all-in price. |
| Range shown | bucket: min…max(+transport); other modes ±15% | Hard-coded | Becomes the customer's offer choices. |
| Driver's price | The driver's own offer | Driver | Capped at **$500** (`max_job_budget`) at launch. |
| Commission | 7% (`commission_rate`), rounded to cents (`commission_amount`) | Configurable | First completed job free (`complete_job`, 0091). Held from the driver's wallet at acceptance. |
| Payment fees | — | **Not modelled** | Customers pay drivers directly; Paynow fees apply only to drivers' wallet top-ups. |
| Silent defaults | Missing distance → 15 km; missing quantity → 12.5 m³ | Assumption | Removed in 0118 (returns `missing_distance` / `missing_quantity`). |

## 2. What changed on this branch

| Change | Where | Live effect |
| --- | --- | --- |
| Engine v1.3: no silent defaults; market quotes all-in; fuel + markup as validated optional settings; every quote reports its assumptions and price date; drivers may read the two new settings | Migration **0118** (prepared, **not applied**); undo restores v1.2 exactly (hash-checked) | None until applied. When applied: only > 20 m³ quotes with market data change (lower, correct). 180-quote grid identical otherwise (pgTAP). |
| One trip rule and one commission rounding in the app, matching the database | `src/lib/driver-economics.ts`; `capacityMatch.ts` now uses it; driver form uses `commissionFee` | The fee shown can no longer drift from the database by a cent. |
| Driver offer form: road distance when the job has one (else "in a straight line"); "You receive" after the fee; **estimated fuel** for the round trip(s) with stated assumptions and exclusions, or why it can't be estimated | `jobs.$id.tsx` | Live after deploy; reads the existing diesel setting. |
| Booking summary: "Based on recent accepted offers…" for market quotes; "Material prices last reviewed {date}" | `customer.book.tsx`, `pricing-display.ts` | Shows only once 0118 is applied (older engine doesn't report these). |

## 3. Proposed feedback loop (not built — needs your approval)

Purpose: learn whether estimates match what jobs actually cost, without letting data change
prices on its own.

1. **Record** (already stored): every job keeps `pricing_breakdown` (estimate, range, distance,
   source, trips) and `final_price` (the accepted offer).
2. **Compare** monthly, read-only: an admin report of completed jobs per material and distance
   band — estimate vs accepted price (median gap, % within range, sample size). Add drivers'
   actual fuel/trip reports later if they're willing to share.
3. **Propose, don't apply:** the report suggests new band or price values only when a cell has
   ≥ 10 completed jobs. A super admin approves each change; the change goes through the existing
   audited setters (`admin_set_*`, step-up sign-in), so `admin_audit_log` records who, when and
   the before/after values.
4. **Never** auto-update `material_prices`, buckets, diesel or commission from the data.

## 4. Data gaps and the smallest pilot that would close them

Gaps: supplier-specific prices (0/13), stock (0/13), exact pins (3/13), material prices 2½
months old, fuel use and the 10 m³ reference truck never measured, no record of drivers' real
running costs, no completed-job sample big enough per material/distance.

Pilot (4 weeks, ~20 jobs):
1. Re-confirm today's prices with the 2 verified suppliers by phone; record date and source.
2. Get exact loading pins for the 10 approximate locations.
3. Ask 5 active drivers for one week of fuel slips and trip distances (voluntary) to check the
   32 L/100 km and return-trip assumptions.
4. For every completed pilot job, compare the estimate with the accepted price (step 3.2 above,
   done by hand at first).
5. Only then propose changes to bands, fuel use or the reference truck — through approval.
