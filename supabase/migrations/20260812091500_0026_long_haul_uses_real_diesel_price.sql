-- 0025 dropped diesel_price_per_liter from the pricing formula entirely
-- in favor of pure zone bands, which would have made the admin's diesel
-- price setting (still editable in admin.settings.tsx) silently dead.
-- Fix: past 50km, where there's no standard market band, the marginal
-- rate is now derived from the real diesel price again — 32L/100km at
-- the live diesel price, with a 1.5x markup over raw fuel cost for
-- driver time/wear/profit on a long haul — instead of a hardcoded
-- $0.90/km. Keeps the admin control meaningful for exactly the
-- distance range it actually needs to matter for.
--
-- Bands for typical distances (0-50km) come from real Zimbabwe tipper
-- operator research: most operators price by zone/flat-rate, not a raw
-- distance × fuel calculation — $20 local, $30 for 10-20km, $40 for
-- 20-30km, $60 for 30-50km. Material cost is now a true per-m³ rate
-- (see 0025) scaled by actual quantity, not a bucketed load price.
--
-- Applied live to ovwrsocjmkpiygipmrdk already; spot-checked against the
-- worked example (10m³ gravel, 25km) before pushing — returned $110
-- material + $40 transport = $150 offer, matching the researched
-- example almost exactly.

CREATE OR REPLACE FUNCTION public.compute_material_offer(_material material_category, _quantity numeric, _distance_km numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _mp public.material_prices;
  _mid_per_m3 numeric;
  _material_component numeric;
  _distance numeric;
  _transport numeric;
  _raw numeric;
  _floor numeric;
  _step int;
  _offer numeric;
  _adjust_max numeric;
  _diesel_price numeric;
  _fuel_l_per_100km constant numeric := 32;
  _long_haul_markup constant numeric := 1.5;
  _long_haul_rate numeric;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = _material;
  IF _mp IS NULL OR NOT _mp.enforced THEN
    RETURN jsonb_build_object(
      'offer', NULL, 'min', NULL, 'max', NULL, 'step', 5, 'enforced', false
    );
  END IF;

  SELECT (value::text)::numeric INTO _diesel_price FROM public.system_settings WHERE key = 'diesel_price_per_liter';
  _diesel_price := COALESCE(_diesel_price, 1.87);
  _long_haul_rate := (_fuel_l_per_100km / 100) * _diesel_price * _long_haul_markup;

  _mid_per_m3 := (_mp.min_price + _mp.max_price) / 2.0;
  _material_component := COALESCE(_quantity, 12.5) * _mid_per_m3 * COALESCE(_mp.demand_multiplier, 1.0);

  _distance := COALESCE(_distance_km, 15);
  _transport := CASE
    WHEN _distance <= 10 THEN 20
    WHEN _distance <= 20 THEN 30
    WHEN _distance <= 30 THEN 40
    WHEN _distance <= 50 THEN 60
    ELSE 60 + (_distance - 50) * _long_haul_rate
  END;

  _floor := COALESCE(_quantity, 12.5) * _mp.min_price;
  _raw := GREATEST(_floor, _material_component + _transport);

  IF _raw < 100 THEN _step := 5;
  ELSIF _raw < 300 THEN _step := 10;
  ELSE _step := 20;
  END IF;

  _offer := GREATEST(_floor, ROUND(_raw / _step) * _step);
  _adjust_max := GREATEST(COALESCE(_quantity, 12.5) * _mp.max_price + _transport, _offer + _step * 3);

  RETURN jsonb_build_object(
    'offer', _offer,
    'min', ROUND(_floor),
    'max', ROUND(_adjust_max),
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true,
    'materialCost', ROUND(_material_component, 2),
    'transportCost', ROUND(_transport, 2)
  );
END
$function$;
