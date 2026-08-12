-- Fixes two real pricing bugs found on review:
-- 1. The distance multiplier capped out around 1.15x by ~44km, even
--    though the service area goes out to 900km — a driver going 800km
--    was priced almost the same as one going 50km, ignoring real fuel
--    cost entirely (despite diesel_price_per_liter already existing as
--    an admin setting, unused here).
-- 2. The quantity multiplier capped out around 1.15x by ~15m³, even
--    though bookings go up to 50m³ — a 50m³ load priced almost the same
--    as a 15m³ one.
-- Both were then clamped to material_prices.max_price on top of that,
-- so even where the raw math would have priced a long/large job higher,
-- the ceiling silently discounted it back down.
--
-- Fix: material cost now scales linearly with quantity against the
-- nominal 12.5m³ (10-15m³) band the admin's min/max range represents.
-- Fuel cost is now real: distance_km * (32 L/100km) * the live
-- diesel_price_per_liter setting, added on top rather than folded into
-- a capped multiplier. min_price remains a floor (never price below the
-- smallest nominal job); max_price is no longer a hard ceiling — it's
-- returned for the "typical range" the admin set, but the final offer
-- can legitimately exceed it for long/large jobs. The 32 L/100km figure
-- matches the constant already used in customer.book.tsx's live preview
-- (kept in sync there too, in the same commit).
--
-- Applied live to ovwrsocjmkpiygipmrdk already and spot-checked: a
-- nominal 12.5m³/15km crusher_run job returns $320 (unchanged shape); a
-- 400km version of the same job correctly returns $560 (was capped near
-- $375 before); a 50m³ nearby job correctly returns $1,260 (was capped
-- near $375 too). Recorded here so migration history matches the live
-- schema.

CREATE OR REPLACE FUNCTION public.compute_material_offer(_material material_category, _quantity numeric, _distance_km numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _mp public.material_prices;
  _mid numeric;
  _qty_ratio numeric;
  _material_component numeric;
  _diesel_price numeric;
  _fuel_l_per_100km constant numeric := 32;
  _fuel_cost numeric;
  _raw numeric;
  _step int;
  _offer numeric;
  _adjust_max numeric;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = _material;
  IF _mp IS NULL OR NOT _mp.enforced THEN
    RETURN jsonb_build_object(
      'offer', NULL, 'min', NULL, 'max', NULL, 'step', 5, 'enforced', false
    );
  END IF;

  SELECT (value::text)::numeric INTO _diesel_price FROM public.system_settings WHERE key = 'diesel_price_per_liter';
  _diesel_price := COALESCE(_diesel_price, 1.87);

  _mid := (_mp.min_price + _mp.max_price) / 2.0;
  _qty_ratio := GREATEST(COALESCE(_quantity, 12.5), 1) / 12.5;
  _material_component := _mid * _qty_ratio * COALESCE(_mp.demand_multiplier, 1.0);

  _fuel_cost := COALESCE(_distance_km, 15) * (_fuel_l_per_100km / 100) * _diesel_price;

  _raw := GREATEST(_mp.min_price, _material_component + _fuel_cost);

  IF _raw < 100 THEN _step := 5;
  ELSIF _raw < 300 THEN _step := 10;
  ELSE _step := 20;
  END IF;

  _offer := GREATEST(_mp.min_price, ROUND(_raw / _step) * _step);

  -- The nudge control in the booking UI uses `max` as its upper bound —
  -- give it headroom above the computed offer (a few steps) instead of
  -- silently capping a legitimately long/large job at the admin's base
  -- range.
  _adjust_max := GREATEST(_mp.max_price, _offer + _step * 3);

  RETURN jsonb_build_object(
    'offer', _offer,
    'min', _mp.min_price,
    'max', _adjust_max,
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true,
    'fuelCost', ROUND(_fuel_cost, 2),
    'materialCost', ROUND(_material_component, 2)
  );
END
$function$;
