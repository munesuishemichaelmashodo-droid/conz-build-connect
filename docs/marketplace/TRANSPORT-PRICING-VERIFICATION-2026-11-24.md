# Transport-only pricing: verification before switching on (24/11/2026)

**Result: the engine is correct to its documented formula; the rates themselves are uncalibrated (an owner decision).**
`compute_transport_offer` was evaluated read-only against production (STABLE, no writes) and matches
`CONZ-NATIONWIDE-PRICING.md` §3 at the live settings (diesel $2.04/L; fuel 32 L/100 km and allowance 1.87 by default
→ $1.2207/km beyond 50 km). pgTAP `1030_transport_price_matrix` pins the matrix below.

| Road km | Load m³ | Trips | Low | Recommended | High |
| --- | --- | --- | --- | --- | --- |
| 5 | 10 | 1 | $17.00 | $20.00 | $23.00 |
| 25 | 12 | 1 | $34.00 | $40.00 | $46.00 |
| 50 | 20 | 1 | $51.00 | $60.00 | $69.00 |
| 51 | 20 | 1 | $52.04 | $61.22 | $70.40 |
| 80 | 20 | 1 | $82.13 | $96.62 | $111.12 |
| 200 | 20 | 1 | $206.64 | $243.11 | $279.58 |
| 440 | 20 | 1 | $455.67 | $536.09 | $616.50 |
| 15 | 30 | 2 | $51.00 | $60.00 | $69.00 |
| 200 | 40 | 2 | $413.29 | $486.22 | $559.15 |

Checks: continuous at the 50 km edge; never decreases with distance (1–600 km); trips = ceil(m³ / 20); out-of-range
distance or load is refused, never priced. Commission is 7% of the transport fare (e.g. $243.11 → $17.02).

## Owner decisions before `transport_pricing_enabled = true`

1. **$500 cap (`max_job_budget`).** It applies to jobs **and bids**. One 20 m³ trip's recommended fare passes $500 at
   **411 km**, and its high guide at **358 km**, so Harare–Bulawayo (≈436 km) cannot be booked or offered. Raise the cap
   (Settings → Launch switches, after PR #132 and 0129), or accept that limit for the pilot.
2. **Rate level.** Beyond 50 km the fare is $1.22/km loaded, with no separate return-empty or waiting allowance. The one
   published competitor figure found (ZimboHaul, undated) is $2.10/km with a $200 minimum. Confirm with 3–5 real driver
   quotes per band before launch; change the inputs only through the audited setter (`admin_set_fuel_assumptions`).
3. **Short urban trips.** $20 for ≤ 10 km per tipper trip: confirm drivers accept it.

Switching on is one setting (super admin): `system_settings.transport_pricing_enabled = true`. The booking form, Terms,
wallet, help, walkthrough, driver offer form and public price check already follow it (0158/0159/0161, live).
