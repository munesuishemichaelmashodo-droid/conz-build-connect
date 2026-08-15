-- Applied live via Supabase MCP on 2026-08-15. Committed here per the
-- CLAUDE.md rule: no migration goes live without its .sql file committed
-- in the same sitting.
--
-- Adds a market-driven pricing fallback for quantities above the largest
-- defined bucket (20m³): instead of immediately requiring a manual/admin
-- custom quote, look at recent accepted driver bids for similar-sized
-- loads of the same material. If there are at least 3 such bids in the
-- last 6 months, derive a price-per-m³ from them and price the load
-- automatically. Otherwise, fall back to the previous behaviour
-- (requiresCustomQuote: true), now annotated with sampleSize so the
-- caller/admin can see how close we are to having enough data.
--
-- Quantities below 10m³ or between existing tiers (e.g. 13m³) are
-- unaffected — they already round up to the next available bucket.

CREATE OR REPLACE FUNCTION public.compute_material_offer(_material material_category, _quantity numeric, _distance_km numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _mp public.material_prices;
  _bucket public.material_price_buckets;
  _mid_bucket_price numeric;
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
  _qty numeric;
  _market_sample_count int;
  _market_price_per_m3 numeric;
  _market_window_frac constant numeric := 0.3;
  _market_min_sample constant int := 3;
  _market_lookback constant interval := interval '6 months';
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = _material;
  IF _mp IS NULL OR NOT _mp.enforced THEN
    RETURN jsonb_build_object(
      'offer', NULL, 'min', NULL, 'max', NULL, 'step', 5, 'enforced', false
    );
  END IF;

  _qty := COALESCE(_quantity, 12.5);

  -- Round up to the smallest available bucket that covers this quantity.
  SELECT * INTO _bucket
  FROM public.material_price_buckets
  WHERE material = _material AND bucket_m3 >= _qty
  ORDER BY bucket_m3 ASC
  LIMIT 1;

  IF _bucket IS NULL THEN
    -- Quantity exceeds our largest defined bucket (20m³). Before falling
    -- back to a manual quote, try to derive a rate from real accepted
    -- driver bids on similar-sized loads of this material -- a genuine
    -- market rate is more trustworthy than a guessed extrapolation, but
    -- only when there's enough recent data to be confident in it.
    SELECT
      count(*),
      avg(
        (CASE WHEN b.counter_status = 'driver_accepted' THEN b.customer_counter_price ELSE b.price END)
        / NULLIF(j.quantity_m3, 0)
      )
    INTO _market_sample_count, _market_price_per_m3
    FROM public.bids b
    JOIN public.jobs j ON j.id = b.job_id
    WHERE b.status = 'accepted'
      AND j.material = _material
      AND j.quantity_m3 BETWEEN _qty * (1 - _market_window_frac) AND _qty * (1 + _market_window_frac)
      AND b.created_at >= now() - _market_lookback;

    IF COALESCE(_market_sample_count, 0) >= _market_min_sample AND _market_price_per_m3 IS NOT NULL THEN
      SELECT (value::text)::numeric INTO _diesel_price FROM public.system_settings WHERE key = 'diesel_price_per_liter';
      _diesel_price := COALESCE(_diesel_price, 1.87);
      _long_haul_rate := (_fuel_l_per_100km / 100) * _diesel_price * _long_haul_markup;

      _material_component := _market_price_per_m3 * _qty * COALESCE(_mp.demand_multiplier, 1.0);

      _distance := COALESCE(_distance_km, 15);
      _transport := CASE
        WHEN _distance <= 10 THEN 20
        WHEN _distance <= 20 THEN 30
        WHEN _distance <= 30 THEN 40
        WHEN _distance <= 50 THEN 60
        ELSE 60 + (_distance - 50) * _long_haul_rate
      END;

      _raw := _material_component + _transport;

      IF _raw < 100 THEN _step := 5;
      ELSIF _raw < 300 THEN _step := 10;
      ELSE _step := 20;
      END IF;

      _offer := ROUND(_raw / _step) * _step;

      RETURN jsonb_build_object(
        'offer', _offer,
        'min', ROUND(_offer * 0.85),
        'max', ROUND(_offer * 1.15),
        'step', _step,
        'label', _mp.label,
        'unit', _mp.unit,
        'enforced', true,
        'materialCost', ROUND(_material_component, 2),
        'transportCost', ROUND(_transport, 2),
        'dataSource', 'market',
        'sampleSize', _market_sample_count
      );
    END IF;

    -- Not enough real driver-bid history yet for this size -- needs a
    -- human quote rather than a guess.
    RETURN jsonb_build_object(
      'offer', NULL, 'min', NULL, 'max', NULL, 'step', 5,
      'label', _mp.label, 'unit', _mp.unit, 'enforced', true,
      'requiresCustomQuote', true,
      'sampleSize', COALESCE(_market_sample_count, 0)
    );
  END IF;

  SELECT (value::text)::numeric INTO _diesel_price FROM public.system_settings WHERE key = 'diesel_price_per_liter';
  _diesel_price := COALESCE(_diesel_price, 1.87);
  _long_haul_rate := (_fuel_l_per_100km / 100) * _diesel_price * _long_haul_markup;

  -- The bucket price IS the whole-load material cost — not multiplied by
  -- quantity again, since it already represents a full 10/12/15/20m³ load.
  _mid_bucket_price := (_bucket.min_price + _bucket.max_price) / 2.0 * COALESCE(_mp.demand_multiplier, 1.0);
  _material_component := _mid_bucket_price;

  _distance := COALESCE(_distance_km, 15);
  _transport := CASE
    WHEN _distance <= 10 THEN 20
    WHEN _distance <= 20 THEN 30
    WHEN _distance <= 30 THEN 40
    WHEN _distance <= 50 THEN 60
    ELSE 60 + (_distance - 50) * _long_haul_rate
  END;

  _floor := _bucket.min_price;
  _raw := GREATEST(_floor, _material_component + _transport);

  IF _raw < 100 THEN _step := 5;
  ELSIF _raw < 300 THEN _step := 10;
  ELSE _step := 20;
  END IF;

  _offer := GREATEST(_floor, ROUND(_raw / _step) * _step);
  _adjust_max := GREATEST(_bucket.max_price + _transport, _offer + _step * 3);

  RETURN jsonb_build_object(
    'offer', _offer,
    'min', ROUND(_floor),
    'max', ROUND(_adjust_max),
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true,
    'materialCost', ROUND(_material_component, 2),
    'transportCost', ROUND(_transport, 2),
    'bucketM3', _bucket.bucket_m3
  );
END
$function$;
