-- 0118 — pricing engine v1.3. Proves: bucket and small-load quotes are identical to
-- v1.2 (copied here as pg_temp.cmo_v12); missing inputs are refused; market-priced
-- big loads no longer add transport twice; assumptions are reported.
begin;
select plan(17);

-- Known prices (production values of 26/10/2026 for river sand and stones).
delete from public.material_price_buckets where material in ('river_sand','stones');
insert into public.material_price_buckets (material, bucket_m3, min_price, max_price) values
  ('river_sand',5,60,80),('river_sand',10,120,160),('river_sand',12,144,192),('river_sand',15,180,240),('river_sand',20,240,320),
  ('stones',5,75,150),('stones',10,150,300),('stones',12,180,360),('stones',15,225,450),('stones',20,300,600);
update public.material_prices set min_price = 12, max_price = 16, enforced = true, demand_multiplier = 1 where material = 'river_sand';
update public.material_prices set min_price = 15, max_price = 30, enforced = true, demand_multiplier = 1 where material = 'stones';
delete from public.system_settings where key in ('fuel_l_per_100km','long_haul_markup');
update public.system_settings set value = to_jsonb(1.87) where key = 'diesel_price_per_liter';

CREATE OR REPLACE FUNCTION pg_temp.cmo_v12(_material material_category, _quantity numeric, _distance_km numeric)
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
  _fuel_l_per_100km constant numeric := 32;
  _long_haul_markup constant numeric := 1.87;
  _long_haul_rate numeric;
  _qty numeric;
  _market_sample_count int;
  _market_price_per_m3 numeric;
  _market_window_frac constant numeric := 0.3;
  _market_min_sample constant int := 3;
  _market_lookback constant interval := interval '6 months';
  _reference_capacity_m3 constant numeric := 10;
  _trip_count int;
  _pricing_version constant text := 'v1.2';
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
  _diesel_price := coalesce(_diesel_price, 2.04);
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

create temp table grid as
select m::public.material_category as m, q::numeric as q, d::numeric as d
  from unnest(array['river_sand','stones']) m,
       unnest(array[0.5, 3, 5, 10, 12, 13, 15, 20, 25, 30]) q,
       unnest(array[0, 5, 10, 15, 25, 40, 50, 80, 200]) d;

-- 1. Everything the market branch doesn't touch is unchanged
select is(
  (select count(*)::int from grid
    where (public.compute_material_offer(m,q,d) - 'assumptions' - 'materialPriceUpdatedAt' - 'pricingVersion')
          is distinct from (pg_temp.cmo_v12(m,q,d) - 'pricingVersion')),
  0, 'All 180 quotes (no market data) are identical to v1.2 apart from the added fields');
select is(public.compute_material_offer('river_sand',12,15)->>'pricingVersion', 'v1.3', 'Version is v1.3');

-- 2. Missing inputs are refused, not guessed
select is(public.compute_material_offer('river_sand',null,15)->>'error', 'missing_quantity', 'A missing quantity is refused');
select is(public.compute_material_offer('river_sand',12,null)->>'error', 'missing_distance', 'A missing distance is refused');
select is((public.compute_material_offer('river_sand',12,null)->>'offer'), null, 'and no price is produced');
select is(public.compute_material_offer('river_sand',-1,15)->>'error', 'invalid_quantity', 'Negative quantities are still refused');

-- 3. Assumptions are reported with their source
select is(public.compute_material_offer('river_sand',12,80)->'assumptions'->>'fuelSource', 'default', 'Fuel use comes from the documented default when no setting exists');
select is((public.compute_material_offer('river_sand',12,80)->'assumptions'->>'dieselPricePerLitre')::numeric, 1.87, 'Diesel price comes from the setting');
select is(public.compute_material_offer('river_sand',12,80)->'assumptions'->>'returnLeg', 'covered by the long-haul markup', 'Says how the empty return is covered on long hauls (0106)');
select ok(public.compute_material_offer('river_sand',12,15) ? 'materialPriceUpdatedAt', 'Reports when the material price was last updated');
insert into public.system_settings (key, value) values ('fuel_l_per_100km', to_jsonb(500));
select is((public.compute_material_offer('river_sand',12,80)->'assumptions'->>'fuelLitresPer100km')::numeric, 32::numeric, 'An impossible fuel setting falls back to the default');
delete from public.system_settings where key = 'fuel_l_per_100km';
update public.system_settings set value = to_jsonb(12) where key = 'diesel_price_per_liter';
select is(public.compute_material_offer('river_sand',12,80)->'assumptions'->>'dieselSource', 'setting',
  'A diesel price the admin setter allows ($12) is used, not replaced by the default');
select is((public.compute_material_offer('river_sand',12,80)->>'offer')::numeric, (pg_temp.cmo_v12('river_sand',12,80)->>'offer')::numeric,
  'and gives the same quote as v1.2');
update public.system_settings set value = to_jsonb(1.87) where key = 'diesel_price_per_liter';

-- 4. Big loads priced from market data: transport is no longer added twice
select set_config('t.c', tests.create_user('pe_cust')::text, true);
select set_config('t.d', tests.create_driver('pe_drv', 500)::text, true);
do $$ declare j uuid; b uuid; begin
  for i in 1..3 loop
    j := tests.create_job(current_setting('t.c')::uuid, 400, 'direct', 'river_sand', 25);
    update public.jobs set quote_id = null where id = j;
    insert into public.bids (job_id, driver_id, price, truck_id, status)
      values (j, current_setting('t.d')::uuid, 500, tests.truck_of(current_setting('t.d')::uuid), 'pending') returning id into b;
    update public.bids set status = 'accepted' where id = b;
  end loop;
end $$;
select is(public.compute_material_offer('river_sand',25,15)->>'dataSource', 'market', 'The 25 m³ quote uses market data');
select is((public.compute_material_offer('river_sand',25,15)->>'offer')::numeric, 500::numeric,
  'The estimate is the all-in market price ($20/m³ × 25 = $500), with no transport added on top');
select cmp_ok((pg_temp.cmo_v12('river_sand',25,15)->>'offer')::numeric, '>', 500::numeric,
  'v1.2 added transport on top of an all-in price');

-- 5. Drivers can read the fuel setting the engine uses
insert into public.system_settings (key, value) values ('fuel_l_per_100km', to_jsonb(30));
select tests.login_as(current_setting('t.d')::uuid);
select is((select (value::text)::numeric from public.system_settings where key = 'fuel_l_per_100km'), 30::numeric,
  'A signed-in driver reads the same fuel setting as the engine');
select tests.as_owner();

select * from finish();
rollback;
