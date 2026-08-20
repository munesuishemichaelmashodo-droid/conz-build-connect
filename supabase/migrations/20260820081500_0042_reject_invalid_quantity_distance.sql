-- 0042: found while boundary-testing 0041 -- compute_material_offer had no
-- guard against quantity <= 0 or distance < 0, so a negative/zero quantity
-- silently produced a negative or nonsensical price instead of being
-- rejected. Add an early guard that returns requiresCustomQuote (the
-- existing "can't price this" signal the frontend already handles) for
-- invalid inputs, before any pricing math runs.

create or replace function public.compute_material_offer(_material material_category, _quantity numeric, _distance_km numeric)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  _fuel_l_per_100km constant numeric := 32;
  _long_haul_markup constant numeric := 1.5;
  _long_haul_rate numeric;
  _qty numeric;
  _market_sample_count int;
  _market_price_per_m3 numeric;
  _market_window_frac constant numeric := 0.3;
  _market_min_sample constant int := 3;
  _market_lookback constant interval := interval '6 months';
  _reference_capacity_m3 constant numeric := 10;
  _trip_count int;
  _pricing_version constant text := 'v1.1';
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

  _qty := coalesce(_quantity, 12.5);

  select (value::text)::numeric into _diesel_price from public.system_settings where key = 'diesel_price_per_liter';
  _diesel_price := coalesce(_diesel_price, 1.87);
  _long_haul_rate := (_fuel_l_per_100km / 100) * _diesel_price * _long_haul_markup;

  _distance := coalesce(_distance_km, 15);
  _transport := case
    when _distance <= 10 then 20
    when _distance <= 20 then 30
    when _distance <= 30 then 40
    when _distance <= 50 then 60
    else 60 + (_distance - 50) * _long_haul_rate
  end;

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
    );
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
      _material_component := _market_price_per_m3 * _qty * coalesce(_mp.demand_multiplier, 1.0);
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
        'dataSource', 'market',
        'sampleSize', _market_sample_count,
        'tripCount', _trip_count,
        'referenceCapacityM3', _reference_capacity_m3,
        'pricingVersion', _pricing_version
      );
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
    );
  end if;

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
  );
end
$function$;
