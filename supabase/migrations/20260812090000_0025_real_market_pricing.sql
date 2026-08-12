-- Replaces material_prices' "10-15 m³ load" bucket pricing with true
-- per-m³ rates, and rewrites compute_material_offer's transport cost from
-- a distance-capped multiplier into the model actual Zimbabwe tipper
-- operators use: Material Cost + Transport Cost, where transport is
-- zone-banded (matches how operators quote: "$20 for local, $40 for
-- 20-30km" etc.) rather than a raw per-km fuel calculation, with a real
-- diesel-cost-based rate taking over only past 50km where no standard
-- band exists.
--
-- Material rates below are the admin's previous per-m³-load figures
-- converted to true per-m³ (divide by 12.5), corrected against real
-- Harare classified listings (classifieds.co.zw, shop.zimcompass.com,
-- zbms.co.zw — checked live) for the six materials with solid market
-- data. top_soil/filling_soil had no comparable classifieds data found,
-- so those are converted to per-m³ only, not re-priced.
--
--   material      | old ($/m³, derived) | new ($/m³, market-checked)
--   gravel        | 13.60 - 18.40       | 9  - 13
--   pit_sand      | 15.20 - 20.80       | 8  - 11
--   river_sand    | 12.80 - 17.60       | 12 - 16
--   quarry_dust   | 36.00 - 42.40       | 10 - 18
--   crusher_run   | 20.00 - 30.00       | 18 - 25
--   stones        | 38.40 - 44.80       | 15 - 30  (wide real range: 3/4 stone size grades vary $15-35)
--
-- Applied live to ovwrsocjmkpiygipmrdk already, superseded immediately
-- after by 0026 (long-haul rate wired back to the real diesel price
-- setting instead of a hardcoded constant) — this file is the first of
-- that pair, kept for migration history accuracy.

UPDATE public.material_prices SET min_price = 9,  max_price = 13, unit = 'per m³' WHERE material = 'gravel';
UPDATE public.material_prices SET min_price = 8,  max_price = 11, unit = 'per m³' WHERE material = 'pit_sand';
UPDATE public.material_prices SET min_price = 12, max_price = 16, unit = 'per m³' WHERE material = 'river_sand';
UPDATE public.material_prices SET min_price = 10, max_price = 18, unit = 'per m³' WHERE material = 'quarry_dust';
UPDATE public.material_prices SET min_price = 18, max_price = 25, unit = 'per m³' WHERE material = 'crusher_run';
UPDATE public.material_prices SET min_price = 15, max_price = 30, unit = 'per m³' WHERE material = 'stones';
UPDATE public.material_prices SET min_price = ROUND(min_price / 12.5, 2), max_price = ROUND(max_price / 12.5, 2), unit = 'per m³' WHERE material = 'top_soil';
UPDATE public.material_prices SET min_price = ROUND(min_price / 12.5, 2), max_price = ROUND(max_price / 12.5, 2), unit = 'per m³' WHERE material = 'filling_soil';
