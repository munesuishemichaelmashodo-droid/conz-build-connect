# ConZ nationwide transport pricing: design (8 November 2026)

Status: **design only. Nothing here changes live prices.** Every number below is marked **UNCALIBRATED** unless it comes from completed ConZ jobs. The new calculation ships behind `system_settings.transport_pricing_enabled` (default `false`). ConZ never changes live rates automatically.

## 1. What the number means

The number a client and driver agree on is the **transport fare**: loading point to delivery point by road, for the vehicle and trips needed. Material or cargo value is outside it. If a driver also sells the material, the agreement card records that separately ("paid to the driver directly, no ConZ commission"). ConZ commission is `round(agreed transport fare x commission_rate / 100, 2)` (7% today), reserved from the driver's prepaid commission credit on accept, released once on a legitimate cancel, charged once on verified completion. The first job stays free.

Why the base is simply the agreed fare and not a "declared transport share": a driver could shrink commission by calling part of the fare "material". Making the agreed amount transport-only by definition removes the incentive and needs no change to the money functions.

## 2. Inputs

| Input | Source | Rule |
| --- | --- | --- |
| Pickup coordinates | Client's real loading point (map pin or address) | Required. Inside the Zimbabwe box (lat -23 to -15, lng 25 to 33.5). No default place. |
| Delivery coordinates | Client's pin | Required, same box |
| Road distance (km) | Server-side OSRM call (`getRoute`) | If routing fails the quote is **refused** with a plain message. No straight-line fallback. No invented distance |
| Load (m3) and material | Client | Trips = ceil(load / vehicle capacity); the reference vehicle is 20 m3 until per-vehicle bands exist |
| Fuel use, diesel price, allowance | Existing `system_settings` (32 L/100 km, $1.87/L, allowance 1.87) | Same settings the current engine uses |
| Calibration history | Completed, undisputed jobs with road-distance-comparable pricing | Used only when thresholds in section 5 are met |

## 3. Formula (v2, UNCALIBRATED)

For one trip of road distance `d` km:

- `d <= 10`: $20; `<= 20`: $30; `<= 30`: $40; `<= 50`: $60 (the current urban bands, kept for continuity).
- `d > 50`: `60 + (d - 50) x rate_per_km`, where `rate_per_km = fuel_l_per_100km / 100 x diesel_price x allowance` = 32 / 100 x 1.87 x 1.87 = **$1.119/km** at today's settings.
- Transport fare for the job = per-trip fare x trips. Show the low / recommended / high guide as today (-15% / 0 / +15%, existing spread).
- Return-empty and waiting time are **not** modelled separately; they sit inside the allowance. UNCALIBRATED.

This reuses the v1.4 transport component, so a nearby urban job prices the same as today minus the material line. It is a continuity baseline, not a claim that these rates are right for every corridor.

## 4. Sample calculations (road km from OSRM, 8 Nov 2026, car profile; per trip, one 20 m3 load)

| Segment | Route | Road km | Fare (v2, UNCALIBRATED) | Note |
| --- | --- | --- | --- | --- |
| Short urban | Harare CBD to Borrowdale | 9.9 | $20.00 | flat band |
| Short urban | Harare CBD to Chitungwiza | 24.0 | $40.00 | flat band |
| Intercity | Harare to Chinhoyi | 117.0 | $134.97 | 60 + 67 x 1.119 |
| Intercity | Harare to Mutare | 262.0 | $297.23 | two trips for 40 m3 = $594.46 |
| Rural | Mutare to Nyanga | 107.4 | $124.23 | mountain road, time longer than distance suggests |
| Rural | Kwekwe to Gokwe | 143.8 | $164.96 | |
| Long haul | Harare to Bulawayo | 435.7 | $491.60 | |
| Long haul | Bulawayo to Victoria Falls | 445.5 | $502.57 | exceeds the $500 launch cap |

Straight-line distance is not used: Harare to Bulawayo is 362 km in a straight line and 435.7 km by road (20% less), which is why straight-line fallback is refused.

Reference only (not adopted): the competitor ZimboHaul publishes $2.10/km with a $200 minimum for construction tippers (undated page). The long-haul figure here is about $1.13/km, roughly 54% of that. Competitor figures are context, not calibration (see the competitor research).

## 5. How rates get set, and when they may change

1. **Today:** assumptions only. The admin sees the "How close are our estimates?" card (`admin_price_accuracy_completed`): completed deliveries versus the guide.
2. **Calibrate a segment** (urban 0-50 km, intercity 51-250 km, long haul over 250 km, by vehicle class) only when there are **at least 10 comparable completed, undisputed jobs and at least 3 distinct drivers** in that segment. Below that the report says "not enough data" and the segment stays on the deterministic formula.
3. **A person changes a rate.** The engine never edits live settings. A super admin changes fuel and allowance values through the existing audited setters (step-up required). Any new segment table ships as a reviewed migration.

## 6. Guard rails and known limitations

- **Launch cap.** `max_job_budget` = $500 per job. Long hauls and multi-trip jobs exceed it (Bulawayo to Victoria Falls $502.57; Harare to Mutare for two trips $594.46). **Owner decision needed** before the switch is turned on: raise the cap, or exempt transport-pricing jobs.
- **Routing profile.** OSRM's public demo server is a car profile, run for non-commercial use. It does not model heavy-vehicle restrictions, steep grades or unpaved rural roads, so distance and time are estimates for a car. Drivers must confirm suitability. Moving to a licensed or self-hosted router with a truck profile is an owner decision. Nothing is shown as a guaranteed ETA.
- **ETA.** Where a number is shown, it is road time x 1.4 (existing rule) and labelled approximate. If routing is unavailable, no ETA or price is shown.
- **Vehicle capacity.** One reference vehicle (20 m3). Different payloads and body types are not priced differently yet.
- **Diesel price** is an owner setting, not market data; fuel use is a flat 32 L/100 km.
- **Old jobs keep the old basis.** `jobs.pricing_basis` records which engine priced a job (`legacy_material_plus_transport` or `transport_only`) so reports and commission explanations stay honest.
- **Open requests** (driver arranges pickup) with the switch on get a real pickup point from the client, so the fixed 10/40/120 km placeholders are not used for new jobs.

## 7. What changes when the switch is turned on (owner go required)

New jobs priced as transport only; the commission base becomes the transport fare; the Terms, wallet and offer copy change from "7% of the full price including materials" to "7% of the agreed transport fare". Existing jobs, supplier tables and admin sourcing screens are untouched. Turning it off again returns new jobs to the legacy engine.
