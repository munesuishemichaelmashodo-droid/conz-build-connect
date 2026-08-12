-- Foundation for the "National Transport Rate Database" idea: a view over
-- completed jobs' actual accepted prices, by material + a distance band
-- matching the ones compute_material_offer already uses. Jobs don't store
-- a distance_km column, so this derives an approximate straight-line
-- (haversine) distance from pickup/delivery coordinates — close enough
-- for banding purposes, though it will run a bit short of the real road
-- distance the job was actually priced against.
--
-- NOT wired into the live pricing formula yet — only 4 jobs have ever
-- completed on the platform, nowhere near enough for a real average to
-- mean anything. Once there's meaningful volume (some hundreds of
-- completed jobs per material/band), compute_material_offer can blend
-- this in as a correction on top of the formula-based estimate instead
-- of relying on the formula alone. For now this just starts collecting
-- the data so that day arrives sooner rather than later.
--
-- Applied live to ovwrsocjmkpiygipmrdk already and spot-checked: 3 of the
-- 4 completed jobs joined cleanly (one is missing pickup/delivery
-- coordinates, so it's excluded rather than mis-banded).

CREATE OR REPLACE VIEW public.market_rate_history AS
SELECT
  j.material,
  band.distance_band,
  COUNT(*) AS trip_count,
  ROUND(AVG(j.budget), 2) AS avg_accepted_price,
  ROUND(AVG(j.budget / NULLIF(j.quantity_m3, 0)), 2) AS avg_price_per_m3,
  MIN(j.budget) AS min_accepted_price,
  MAX(j.budget) AS max_accepted_price
FROM public.jobs j
CROSS JOIN LATERAL (
  SELECT
    2 * 6371 * asin(sqrt(
      power(sin(radians(j.delivery_lat - j.pickup_lat) / 2), 2) +
      cos(radians(j.pickup_lat)) * cos(radians(j.delivery_lat)) *
      power(sin(radians(j.delivery_lng - j.pickup_lng) / 2), 2)
    )) AS km
) d
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN d.km <= 10 THEN '0-10km'
    WHEN d.km <= 20 THEN '10-20km'
    WHEN d.km <= 30 THEN '20-30km'
    WHEN d.km <= 50 THEN '30-50km'
    ELSE '50km+'
  END AS distance_band
) band
WHERE j.status = 'completed'
  AND j.pickup_lat IS NOT NULL AND j.pickup_lng IS NOT NULL
  AND j.delivery_lat IS NOT NULL AND j.delivery_lng IS NOT NULL
GROUP BY j.material, band.distance_band;

GRANT SELECT ON public.market_rate_history TO authenticated;
