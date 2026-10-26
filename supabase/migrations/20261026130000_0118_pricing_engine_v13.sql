-- -----------------------------------------------------------------------------
-- 0118: pricing engine v1.3 — explicit assumptions, no silent defaults, no
-- double-counted transport.
--
-- PREPARED, NOT APPLIED. Changes quotes only where noted below; needs the owner's
-- approval before production. No DROP (CREATE OR REPLACE; grants are kept).
-- Undo: supabase/rollbacks/20261026130000_0118_rollback.sql (v1.2 exactly as live on
-- 26/10/2026, hash-checked).
--
-- What changes (pgTAP 490_pricing_engine_v13 proves everything else is identical):
--  1. A null quantity or distance now returns requiresCustomQuote with
--     error missing_quantity / missing_distance, instead of quietly pricing 12.5 m³
--     or 15 km. Every app path already passes both (tg_validate_job_budget computes
--     its own distance), so no live quote changes from this.
--  2. Loads over 20 m³ priced from market data: accepted offers are all-in, so the
--     estimate is now that all-in figure; transport is no longer added on top.
--     materialCost/transportCost are null for this mode (not separable).
--  3. Fuel use (fuel_l_per_100km, default 32) and the long-haul markup
--     (long_haul_markup, default 1.87 = the empty-return allowance from 0106) become
--     optional settings, validated with the
--     diesel price; with no setting rows (today) the numbers are exactly as before.
--  5. Signed-in users may read the two new settings (as they already read the diesel
--     price), so the driver's fuel estimate uses the same numbers as the engine.
--  4. Every quote reports its assumptions (distance band, diesel/fuel/markup and
--     where each came from, how the empty return is covered) and materialPriceUpdatedAt.
-- -----------------------------------------------------------------------------

begin;

CREATE OR REPLACE FUNCTION public.compute_material_offer(_material material_category, _quantity numeric, _distance_km numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _mp public.material_prices;
  _bucket public.material_price_buckets;
  _small public.small_load_settings;
  _mid_bucket_price numeric;
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
  _fuel_l_per_100km numeric;      -- (0118) setting fuel_l_per_100km, default 32
  _long_haul_markup numeric;      -- (0118) setting long_haul_markup, default 1.87
  _diesel_source text := 'setting';
  _fuel_source text := 'setting';
  _markup_source text := 'setting';
  _assumptions jsonb;
  _price_updated timestamptz;
  _long_haul_rate numeric;
  _qty numeric;
  _market_sample_count int;
  _market_price_per_m3 numeric;
  _market_window_frac constant numeric := 0.3;
  _market_min_sample constant int := 3;
  _market_lookback constant interval := interval '6 months';
  _reference_capacity_m3 constant numeric := 10;
  _trip_count int;
  _pricing_version constant text := 'v1.3';
begin
  -- Guard: reject impossible inputs before any pricing math runs. A
  -- negative/zero quantity or negative distance is never a valid quote,
  -- regardless of material.
  if _quantity is not null and _quantity <= 0 then
    return jsonb_build_object(
      'offer', null, 'min', null, 'max', null, 'step', 5,
      'enforced', true, 'requiresCustomQuote', true,
      'error', 'invalid_quantity',
      'pricingVersion', _pricing_version
    );
  end if;

  if _distance_km is not null and _distance_km < 0 then
    return jsonb_build_object(
      'offer', null, 'min', null, 'max', null, 'step', 5,
      'enforced', true, 'requiresCustomQuote', true,
      'error', 'invalid_distance',
      'pricingVersion', _pricing_version
    );
  end if;

  -- (0118) No silent defaults: a quote needs a real quantity and distance.
  if _quantity is null or _distance_km is null then
    return jsonb_build_object(
      'offer', null, 'min', null, 'max', null, 'step', 5,
      'enforced', true, 'requiresCustomQuote', true,
      'error', case when _quantity is null then 'missing_quantity' else 'missing_distance' end,
      'pricingVersion', _pricing_version
    );
  end if;

  select * into _mp from public.material_prices where material = _material;
  if _mp is null or not _mp.enforced then
    return jsonb_build_object(
      'offer', null, 'min', null, 'max', null, 'step', 5,
      'enforced', false, 'requiresCustomQuote', true,
      'label', coalesce(_mp.label, initcap(replace(_material::text, '_', ' '))),
      'unit', coalesce(_mp.unit, ''),
      'pricingVersion', _pricing_version
    );
  end if;

  _qty := _quantity;
  _price_updated := _mp.updated_at;

  select (value::text)::numeric into _diesel_price from public.system_settings where key = 'diesel_price_per_liter';
  -- (0118) Every operating assumption is validated and reported, with its source.
  if _diesel_price is null or _diesel_price <= 0 or _diesel_price > 10 then
    _diesel_price := 2.04; _diesel_source := 'default';
  end if;
  select (value::text)::numeric into _fuel_l_per_100km from public.system_settings where key = 'fuel_l_per_100km';
  if _fuel_l_per_100km is null or _fuel_l_per_100km <= 0 or _fuel_l_per_100km > 100 then
    _fuel_l_per_100km := 32; _fuel_source := 'default';
  end if;
  select (value::text)::numeric into _long_haul_markup from public.system_settings where key = 'long_haul_markup';
  if _long_haul_markup is null or _long_haul_markup < 1 or _long_haul_markup > 5 then
    _long_haul_markup := 1.87; _markup_source := 'default';
  end if;
  _long_haul_rate := (_fuel_l_per_100km / 100) * _diesel_price * _long_haul_markup;

  _distance := _distance_km;
  _transport := case
    when _distance <= 10 then 20
    when _distance <= 20 then 30
    when _distance <= 30 then 40
    when _distance <= 50 then 60
    else 60 + (_distance - 50) * _long_haul_rate
  end;

  _assumptions := jsonb_build_object(
    'distanceKm', _distance,
    'transportBand', case when _distance <= 10 then '0-10 km flat $20' when _distance <= 20 then '10-20 km flat $30'
                          when _distance <= 30 then '20-30 km flat $40' when _distance <= 50 then '30-50 km flat $60'
                          else 'over 50 km: $60 + fuel per km' end,
    'dieselPricePerLitre', _diesel_price, 'dieselSource', _diesel_source,
    'fuelLitresPer100km', _fuel_l_per_100km, 'fuelSource', _fuel_source,
    'longHaulMarkup', _long_haul_markup, 'markupSource', _markup_source,
    'longHaulRatePerKm', round(_long_haul_rate, 4),
    -- 0106: up to 50 km the bands are flat all-in fees; beyond 50 km the markup
    -- (1.87) is the allowance for driving back empty.
    'returnLeg', case when _distance <= 50 then 'included in the flat band'
                      else 'covered by the long-haul markup' end,
    'referenceCapacityM3', _reference_capacity_m3
  );

  if _qty < 1 then
    select * into _small from public.small_load_settings where material = _material;

    if _small is null or not _small.enabled then
      return jsonb_build_object(
        'offer', null, 'min', null, 'max', null, 'step', 5,
        'enforced', true, 'requiresCustomQuote', true,
        'label', _mp.label, 'unit', _mp.unit,
        'pricingVersion', _pricing_version
      );
    end if;

    _mid_per_m3 := (_mp.min_price + _mp.max_price) / 2.0 * coalesce(_mp.demand_multiplier, 1.0);
    _material_component := _mid_per_m3 * _qty;
    _transport := greatest(_small.minimum_trip_charge, _transport);
    _raw := _material_component + _transport;

    if _raw < 100 then _step := 5;
    elsif _raw < 300 then _step := 10;
    else _step := 20;
    end if;

    _offer := round(_raw / _step) * _step;

    return jsonb_build_object(
      'offer', _offer,
      'min', round(_offer * 0.85),
      'max', round(_offer * 1.15),
      'low', round(_offer * 0.85),
      'recommended', _offer,
      'high', round(_offer * 1.15),
      'step', _step,
      'label', _mp.label,
      'unit', _mp.unit,
      'enforced', true,
      'materialCost', round(_material_component, 2),
      'transportCost', round(_transport, 2),
      'mode', 'small_load',
      'tripCount', 1,
      'referenceCapacityM3', _reference_capacity_m3,
      'pricingVersion', _pricing_version
    ) || jsonb_build_object('assumptions', _assumptions, 'materialPriceUpdatedAt', _price_updated);
  end if;

  select * into _bucket
  from public.material_price_buckets
  where material = _material and bucket_m3 >= _qty
  order by bucket_m3 asc
  limit 1;

  if _bucket is null then
    _trip_count := ceil(_qty / _reference_capacity_m3)::int;

    select
      count(*),
      avg(
        (case when b.counter_status = 'driver_accepted' then b.customer_counter_price else b.price end)
        / nullif(j.quantity_m3, 0)
      )
    into _market_sample_count, _market_price_per_m3
    from public.bids b
    join public.jobs j on j.id = b.job_id
    where b.status = 'accepted'
      and j.material = _material
      and j.quantity_m3 between _qty * (1 - _market_window_frac) and _qty * (1 + _market_window_frac)
      and b.created_at >= now() - _market_lookback;

    if coalesce(_market_sample_count, 0) >= _market_min_sample and _market_price_per_m3 is not null then
      -- (0118) Accepted offers are all-in (material + transport): using their price per m³
      -- AND adding transport counted transport twice. The all-in figure is the estimate.
      _raw := _market_price_per_m3 * _qty * coalesce(_mp.demand_multiplier, 1.0);
      _material_component := null;
      _transport := null;

      if _raw < 100 then _step := 5;
      elsif _raw < 300 then _step := 10;
      else _step := 20;
      end if;

      _offer := round(_raw / _step) * _step;

      return jsonb_build_object(
        'offer', _offer,
        'min', round(_offer * 0.85),
        'max', round(_offer * 1.15),
        'low', round(_offer * 0.85),
        'recommended', _offer,
        'high', round(_offer * 1.15),
        'step', _step,
        'label', _mp.label,
        'unit', _mp.unit,
        'enforced', true,
        'materialCost', round(_material_component, 2),
        'transportCost', round(_transport, 2),
        'dataSource', 'market',
        'sampleSize', _market_sample_count,
        'tripCount', _trip_count,
        'referenceCapacityM3', _reference_capacity_m3,
        'pricingVersion', _pricing_version
      ) || jsonb_build_object('assumptions', _assumptions, 'materialPriceUpdatedAt', _price_updated);
    end if;

    _mid_per_m3 := (_mp.min_price + _mp.max_price) / 2.0 * coalesce(_mp.demand_multiplier, 1.0);
    _material_component := _mid_per_m3 * _qty;
    _transport := _transport * _trip_count;
    _raw := _material_component + _transport;

    if _raw < 100 then _step := 5;
    elsif _raw < 300 then _step := 10;
    else _step := 20;
    end if;

    _offer := round(_raw / _step) * _step;

    return jsonb_build_object(
      'offer', _offer,
      'min', round(_offer * 0.85),
      'max', round(_offer * 1.15),
      'low', round(_offer * 0.85),
      'recommended', _offer,
      'high', round(_offer * 1.15),
      'step', _step,
      'label', _mp.label,
      'unit', _mp.unit,
      'enforced', true,
      'materialCost', round(_material_component, 2),
      'transportCost', round(_transport, 2),
      'dataSource', 'reference_capacity',
      'sampleSize', coalesce(_market_sample_count, 0),
      'tripCount', _trip_count,
      'referenceCapacityM3', _reference_capacity_m3,
      'pricingVersion', _pricing_version
    ) || jsonb_build_object('assumptions', _assumptions, 'materialPriceUpdatedAt', _price_updated);
  end if;

  _price_updated := greatest(_mp.updated_at, _bucket.updated_at);
  _mid_bucket_price := (_bucket.min_price + _bucket.max_price) / 2.0 * coalesce(_mp.demand_multiplier, 1.0);
  _material_component := _mid_bucket_price;

  _floor := _bucket.min_price;
  _raw := greatest(_floor, _material_component + _transport);

  if _raw < 100 then _step := 5;
  elsif _raw < 300 then _step := 10;
  else _step := 20;
  end if;

  _offer := greatest(_floor, round(_raw / _step) * _step);
  _adjust_max := greatest(_bucket.max_price + _transport, _offer + _step * 3);

  return jsonb_build_object(
    'offer', _offer,
    'min', round(_floor),
    'max', round(_adjust_max),
    'low', round(_floor),
    'recommended', _offer,
    'high', round(_adjust_max),
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true,
    'materialCost', round(_material_component, 2),
    'transportCost', round(_transport, 2),
    'bucketM3', _bucket.bucket_m3,
    'tripCount', 1,
    'referenceCapacityM3', _reference_capacity_m3,
    'pricingVersion', _pricing_version
  ) || jsonb_build_object('assumptions', _assumptions, 'materialPriceUpdatedAt', _price_updated);
end
$function$;

-- Drivers' fuel estimate reads the same settings the engine uses (they are not secret).
alter policy "Public settings readable by authenticated" on public.system_settings
  using (key = any (array['diesel_price_per_liter'::text, 'commission_rate'::text,
                          'fuel_l_per_100km'::text, 'long_haul_markup'::text]));

commit;
