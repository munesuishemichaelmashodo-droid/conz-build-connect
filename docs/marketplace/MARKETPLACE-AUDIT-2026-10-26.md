# Marketplace audit — jobs, offers, pricing, suppliers (26/10/2026)

Evidence: read-only queries on production (`ovwrsocjmkpiygipmrdk`) and the code on
`ccr-4fab7e0d-2b8j1o`. No production data or settings were changed.

## 1. The "customer can't see the offer" report

**Not reproduced; no data loss.** For the two $230 jobs on 26/10:

| Job | Offer | What happened |
| --- | --- | --- |
| `4c30…` (customer A, driver W) | $230, created 04:47, re-sent 05:22, expiring 05:52:40 | The customer screenshot (05:32:47, "valid for 19:53") is this offer. The customer chose it at 05:32:50. Job accepted. |
| `f319…` (customer B, driver H) | $230, created 05:30:21, re-sent 05:32:16 | Saved on the right job, `pending`. Running the customer's own access rules (rolled-back transaction): the offer, the driver's profile and the job are all visible. |

The two screenshots are of different jobs, customers and drivers. Both jobs are
**open requests** ("River sand", no listed supplier covers the delivery point), so the
customer's $230 is the open-request guide (40 km typical haul) and the driver's $230 is
the driver's own price; pickup is "Driver arranges it" with no pin.

**Real defect found while tracing it — fixed:** the customer's offer list and every
countdown decided "expired" with the phone's clock, while the database decides with its
own (`tg_bids_offer_expiry`, `accept_bid`). Reproduced in the browser: a phone 20 min fast
showed "2 drivers offered" instead of 3 and countdowns 20 min short. Now corrected
against the server's clock (`src/lib/server-clock.ts`); same test shows 3 offers and the
right countdowns.

**Second gap — prepared as 0117 (not applied):** nothing stopped an account that is both
customer and driver (4 such accounts live) from offering on and accepting its own job
through the API. 0 of 50 offers so far. 0117 adds the check to `tg_guard_bid_insert` and
`accept_bid`; pgTAP `480_no_offers_on_own_job` (7 tests); undo restores the exact
production definitions (hash-checked).

## 2. Job and offer state machine (as enforced today)

Job (`jobs.status`): `open` → `accepted` → `in_progress` → `completed`; `open|accepted|in_progress` → `cancelled`; open jobs also expire (`expire_stale_open_jobs`).

Offer (`bids.status`): `pending` → `accepted` | `rejected` | `withdrawn`; expiry is a
time (`expires_at`), not a status: a pending offer past `expires_at` can't be accepted.

| Transition | Who | Enforced by |
| --- | --- | --- |
| Create offer (`pending`, 30-min window) | Approved driver, unlimited wallet, own truck, job `open`, unassigned, not expired; (0117) not own job | RLS "Drivers create bids", `tg_guard_bid_insert`, `bids_guard_insert` (forces `pending`), `tg_stamp_bid_capacity`, `tg_enforce_launch_bid_limit` (≤ $500), `tg_bids_offer_expiry` |
| Edit / re-send (restarts 30 min) | That driver, only while `pending`, not during a counter-offer | `bids_guard_direct_write`, `tg_bids_offer_expiry` |
| Status change by direct write | Nobody but admins | `bids_guard_direct_write` |
| Withdraw | That driver | `withdraw_bid()` |
| Counter-offer / accept counter | Customer / driver | `counter_bid()`, `accept_counter()` |
| Accept (`accepted`, others `rejected`, job `accepted`, commission held) | The job's customer; offer `pending`, not expired, valid price, driver has the commission balance; (0117) not their own | `accept_bid()` with row locks on bid and job — two customers' taps or two drivers can't both win |
| Duplicate offer | One offer per driver per job | unique `(job_id, driver_id)`; the app upserts |

## 3. Pricing — how a number is produced today

Single engine: `compute_material_offer(material, quantity, distance_km)` (v1.2), called by
`computeOffer` / `computePublicOffer` (server) and `tg_validate_job_budget` (database).

| Input | Source | Notes |
| --- | --- | --- |
| Material price | `material_prices` (min/max per m³, `enforced`, `demand_multiplier`) and `material_price_buckets` (min/max per load size) | **National per material.** Supplier-specific prices (`material_supply_locations.price_override_*`) exist but are **never read**. |
| Pickup | `resolve_material_source_candidates` → nearest eligible verified supply location | None → open request (driver arranges pickup). |
| Distance | Road route (OSRM) from that location to the delivery pin | Straight-line fallback is refused (`assertRoadDistance`). |
| Transport | ≤10 km $20, ≤20 $30, ≤30 $40, ≤50 $60, then $60 + (km−50) × 0.32 L/km × diesel × 1.87 | Diesel from `system_settings.diesel_price_per_liter` (default $2.04 if missing). |
| Load size | ≤ 20 m³: next bucket up, one trip. > 20 m³: trips = ceil(qty / 10 m³ reference truck). < 1 m³: minimum trip charge (`small_load_settings`). | |
| Output | `offer` (rounded to $5/$10/$20), `min`/`max`, `low`/`recommended`/`high`, `materialCost`, `transportCost`, `tripCount` | Shown to customers as an estimate; it becomes the customer's **offer to drivers**, not a confirmed price. |
| Open request | Same engine at 10 / 40 / 120 km | Guide range only; no quote stored. |
| Driver's price | Driver chooses; capped at $500 at launch | Independent of the estimate. |
| Commission | 7% of the final price (`system_settings.commission_rate`), first completed job free | Held from the driver's wallet at acceptance (`hold_job_commission`). |

**Findings (need a migration — not changed):**
1. **Transport counted twice for big loads with market data.** In the > 20 m³ branch with ≥ 3 similar accepted jobs in 6 months, it averages accepted offer prices per m³ — which already include transport — then adds transport × trips again. Rare today; will over-quote as volume grows. Fix: use the average all-in price directly, or average only material cost.
2. **Silent defaults.** A null distance becomes 15 km and a null quantity 12.5 m³. The app always passes both, but the database trigger path should refuse instead of guessing.
3. **Supplier prices unused.** Either wire `price_override_*` into the engine for the resolved location (with a "last confirmed" date) or drop the columns; today the admin can enter numbers that change nothing.

**Calculator:** not built in this round. It must call this same engine (no second formula)
and needs findings 1–3 decided first, otherwise it would display numbers the owner already
knows are wrong for large loads. An admin-only page calling `compute_material_offer` with a
breakdown of the fields above is about a day's work once decided.

## 4. Suppliers — what exists and a pilot plan

Exists: `suppliers` (name, contact, `verification_status`, notes; contacts admin-only after
0115), `material_supply_locations` (material, pin, address, status, verification, service
radius, operating hours, `available_quantity_m3`, price overrides, priority), admin screens
`admin.sourcing` and `admin.supply-coverage`, sourcing requests. Live: 2 verified suppliers,
13 locations, 3 materials covered; 9 of 88 jobs were open requests.

Missing for a pilot of 5–10 real quarries/yards:
- **"Last confirmed" date** on location stock and price, and a "needs reconfirming" list (e.g. older than 14 days), so stale data stops being shown as current.
- **Source of each price** (who said it, when) and the price-override decision above.
- **Duplicate check** on supplier name/phone when an admin adds one.
- No public self-service yet: admins enter suppliers after a phone call, which keeps verification simple while numbers are small.

Suggested pilot: call 5 yards that already serve the open-request areas; record materials,
loading pin, hours, indicative price and today's date; mark verified only after a visit or
a confirmed WhatsApp location; reconfirm weekly.
