# Shared tracking link: map review (28/10/2026)

Page: `/track/$token` (the link a customer shares; no login).

## What was wrong
- Two maps of the same truck: a "live" map zoomed on the truck (delivery site off-screen) and a
  separate route map that did not fit the site either, with two different truck/pin styles (emoji).
- Arrival time was a car time from the free route service: 8 min for 8.2 km across Harare with a
  loaded 12 m³ tipper.
- A new route was requested on every 15-second refresh while the truck moved.
- With no live location yet, no map at all, although the delivery site is known.

## What changed (branch `design/public-tracking-map`, no database change)
- One map, `src/components/tracking/LiveDeliveryMap.tsx`: truck + delivery site + road route, the
  whole trip kept in view until the person pans/zooms ("Show whole trip" brings it back), a
  bigger-map button, chip "About 12 min away · 8.2 km", arrival time / drive time / distance.
- Truck time = car time × 1.4 (`TRUCK_TIME_FACTOR` in `src/lib/live-map.ts`); tune it later from
  real trips (`job_route_points` vs estimates).
- Route re-asked only after 250 m of movement or 3 minutes.
- Out-of-date position: grey truck, no route or ETA, "Waiting for a fresh location".
- Within 150 m of the site: "Farai is at the delivery site".
- No live location: the map still shows the delivery site pin.
- Dark mode uses CARTO Dark Matter tiles (same key); "Open the delivery site in Google Maps" link
  (a plain link, no Google API or cost).

## Free-service limits to watch
| Service | Used for | Terms (checked 28/10/2026) |
| --- | --- | --- |
| CARTO basemaps (key `VITE_CARTO_API_KEY`) | all app map tiles | Commercial free tier: 1,000,000 tile requests a month; above that, rate-limited/blocked or the Commercial Plan ($500/month). From 1 December 2026 this applies to all keys. Server-side caching/proxying not allowed. |
| OpenFreeMap | fallback if CARTO becomes a problem | Free, no key, commercial use allowed, no request limit. Vector tiles: needs MapLibre GL instead of Leaflet (larger change). |
| OSRM demo server (`router.project-osrm.org`) | route line, ETA **and quote road distance** | Best effort, "can be withdrawn at any time", "excessive use is not allowed". Pricing depends on it (falls back to straight-line distance). |
| openrouteservice | possible truck routing (`driving-hgv`) | Free standard plan ~2,000 directions/day; commercial use unclear on the free plan — ask enquiry@openrouteservice.org. |

Sources: carto.com/basemaps, carto.com/legal/basemap-terms, openfreemap.org,
github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy, openrouteservice.org/plans.

## Database part: 0126 (written and tested, apply after the app is deployed)
`supabase/migrations/20261028100000_0126_public_tracking_details.sql`, undo in `supabase/rollbacks/`.
`get_public_tracking` now also returns:
1. **Step times**: loaded (pickup photo), arrived at the site, delivered. Shown as "Loaded 10:12" and
   "Arrived at the site 11:05" on the page.
2. **Truck direction** (`driver_locations.heading`, rounded to 15°): a small arrow on the truck.
3. **Line driven since loading** (`job_route_points`, only while in progress, at most ~200 points,
   ~11 m precision): a dotted line behind the truck.
4. **Cancelled jobs** return `{"status":"cancelled"}` only, so the page says "This delivery was
   cancelled" instead of "link not found".
Never returned: pickup point, customer, prices, PIN, driver phone. pgTAP `580_public_tracking_details`
(16 tests); `080` updated for the cancelled case. The app copes with 0126 missing (fields optional).

## Abuse guard on the no-login endpoints
`getRoute`, address search and reverse geocode now refuse coordinates outside Zimbabwe (plus a margin)
and limit each address to 240 routes / 120 searches a minute per server instance (`src/lib/public-guard*`).
Limits are high on purpose: mobile networks share one address between many phones.
