-- -----------------------------------------------------------------------------
-- 0127: pricing engine v1.4 (owner decisions 02/11/2026; design
-- docs/superpowers/specs/2026-11-02-pricing-finalization-design.md, revision 2).
--
-- No DROP. Writes no settings or prices (the saved diesel price, $1.87/L, is untouched).
-- Undo: supabase/rollbacks/20261102100000_0127_rollback.sql. pgTAP 590 (and 490 updated).
--
-- compute_material_offer (v1.3 -> v1.4):
--   1. Customer estimate trips = ceil(quantity / 20) for every size (was a 10 m³ reference
--      above 20 m³, so 20.01 m³ jumped from 1 to 3 trips). Up to 20 m³ nothing changes.
--      Drivers' own trips still come from their registered truck (tg_stamp_bid_capacity).
--   2. Loads over 20 m³ learn only from completed, comparable, undisputed jobs (one row per
--      job): >= 10 jobs and >= 3 distinct drivers, median price per m³, road distance within
--      +-50% (or both <= 10 km). Accepted-but-unfinished offers no longer count. Otherwise the
--      deterministic calculation (mid price per m³ x qty + delivery fee x trips).
--   3. Lowest allowed budget for 1-20 m³ = bucket minimum + the one delivery fee already in
--      the recommended price, never above it (was the bucket minimum alone).
--   4. Fuel use valid 10-80 L/100 km, long-haul allowance 1-3 (same bounds as the new setter);
--      otherwise the documented defaults 32 and 1.87. Diesel: setting, or $2.04 if missing or
--      invalid. A setting that isn't a plain number now falls back instead of failing every quote.
-- New: admin_price_accuracy_completed (completed deliveries only; the existing report stays
-- as "customer accepted"), admin_set_fuel_assumptions (super admin + require_aal2 + bounds +
-- reason + admin_audit_log).
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
  _market_min_sample constant int := 10;      -- (0127) completed jobs
  _market_min_drivers constant int := 3;      -- (0127) distinct drivers
  _market_driver_count int;
  _bucket_low numeric;
  _market_lookback constant interval := interval '6 months';
  _reference_capacity_m3 constant numeric := 20;  -- (0127) one rule for every size: ceil(qty / 20)
  _trip_count int;
  _pricing_version constant text := 'v1.4';
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

  -- (0127) A value that isn't a plain number falls back to the default instead of failing the quote.
  select case when (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into _diesel_price from public.system_settings where key = 'diesel_price_per_liter';
  -- (0118) Every operating assumption is validated and reported, with its source.
  -- Same bounds as admin_set_diesel_price (0 < price <= 100), so a value the admin can
  -- set is always the value used.
  if _diesel_price is null or _diesel_price <= 0 or _diesel_price > 100 then
    _diesel_price := 2.04; _diesel_source := 'default';
  end if;
  -- (0127) A value that isn't a plain number falls back to the default instead of failing the quote.
  select case when (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into _fuel_l_per_100km from public.system_settings where key = 'fuel_l_per_100km';
  if _fuel_l_per_100km is null or _fuel_l_per_100km < 10 or _fuel_l_per_100km > 80 then
    _fuel_l_per_100km := 32; _fuel_source := 'default';
  end if;
  -- (0127) A value that isn't a plain number falls back to the default instead of failing the quote.
  select case when (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into _long_haul_markup from public.system_settings where key = 'long_haul_markup';
  if _long_haul_markup is null or _long_haul_markup < 1 or _long_haul_markup > 3 then
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
    'referenceCapacityM3', _reference_capacity_m3,
    'tripRule', 'Assumes loads of up to 20 m³ per trip. A smaller truck needs more trips; the driver''s offer includes that.'
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

    -- (0127) Only completed, comparable, undisputed deliveries count, one row per job:
    -- completed with a real final price and quantity, delivered quantity within 10%, no dispute
    -- other than a rejected one, quantity within +-30%, a road distance within +-50% (or both
    -- <= 10 km), in the last 6 months. Median per m3, so one unusual job can't move it.
    select count(*), count(distinct j.driver_id),
           percentile_cont(0.5) within group (order by j.final_price / j.quantity_m3)
      into _market_sample_count, _market_driver_count, _market_price_per_m3
      from public.jobs j
     where j.status = 'completed'
       and j.material = _material
       and j.material <> 'custom'
       and j.final_price > 0
       and j.quantity_m3 > 0
       and j.driver_id is not null
       and j.quantity_m3 between _qty * (1 - _market_window_frac) and _qty * (1 + _market_window_frac)
       and (j.delivered_quantity_m3 is null
            or abs(j.delivered_quantity_m3 - j.quantity_m3) <= 0.1 * j.quantity_m3)
       and coalesce(j.completed_at, j.updated_at) >= now() - _market_lookback
       and not exists (select 1 from public.disputes d
                        where d.job_id = j.id and d.status <> 'rejected'::public.dispute_status)
       and coalesce(j.pricing_breakdown->>'distance_source', 'haversine') <> 'haversine'
       and (j.pricing_breakdown->>'distance_km') ~ '^[0-9]+(\.[0-9]+)?$'
       and ((j.pricing_breakdown->>'distance_km')::numeric between _distance * 0.5 and _distance * 1.5
            or ((j.pricing_breakdown->>'distance_km')::numeric <= 10 and _distance <= 10));

    if coalesce(_market_sample_count, 0) >= _market_min_sample
       and coalesce(_market_driver_count, 0) >= _market_min_drivers
       and _market_price_per_m3 is not null then
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
        'dataSource', 'completed_jobs',
        'sampleSize', _market_sample_count,
        'driverCount', _market_driver_count,
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
  -- (0127) The lowest allowed budget includes the same single delivery fee that is in the
  -- recommended price (material midpoint + transport), and never exceeds it.
  _bucket_low := least(_bucket.min_price + _transport, _offer);

  return jsonb_build_object(
    'offer', _offer,
    'min', round(_bucket_low),
    'max', round(_adjust_max),
    'low', round(_bucket_low),
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
-- Grants unchanged from production (anon + authenticated + service_role).
revoke all on function public.compute_material_offer(public.material_category, numeric, numeric) from public;
grant execute on function public.compute_material_offer(public.material_category, numeric, numeric)
  to anon, authenticated, service_role;

-- Completed deliveries only (the existing admin_price_accuracy keeps "customer accepted").
create or replace function public.admin_price_accuracy_completed(_days integer default 180)
returns table (
  material text,
  jobs integer,
  median_estimate numeric,
  median_accepted numeric,
  median_gap_pct numeric,
  within_15_pct integer,
  last_job_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  with s as (
    select j.material::text as material,
           (j.pricing_breakdown->>'recommended')::numeric as est,
           j.final_price::numeric as acc,
           j.created_at
      from public.jobs j
     where j.pricing_breakdown ? 'recommended'
       and (j.pricing_breakdown->>'recommended') ~ '^[0-9]+(\.[0-9]+)?$'
       and (j.pricing_breakdown->>'recommended')::numeric > 0
       and j.final_price > 0
       and j.status = 'completed'
       and j.created_at >= now() - make_interval(days => greatest(1, least(coalesce(_days, 180), 730)))
  )
  select s.material,
         count(*)::int,
         round(percentile_cont(0.5) within group (order by s.est)::numeric, 2),
         round(percentile_cont(0.5) within group (order by s.acc)::numeric, 2),
         round(percentile_cont(0.5) within group (order by (s.acc - s.est) / s.est * 100)::numeric, 1),
         count(*) filter (where abs(s.acc - s.est) / s.est <= 0.15)::int,
         max(s.created_at)
    from s
   group by s.material
   order by count(*) desc, s.material;
end $$;
revoke all on function public.admin_price_accuracy_completed(integer) from public, anon;
grant execute on function public.admin_price_accuracy_completed(integer) to authenticated;

-- Fuel use and long-haul allowance, same protections as admin_set_diesel_price.
create or replace function public.admin_set_fuel_assumptions(
  _fuel_l_per_100km numeric, _long_haul_markup numeric, _reason text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare _old jsonb;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change fuel assumptions.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _fuel_l_per_100km is null or _fuel_l_per_100km < 10 or _fuel_l_per_100km > 80 then
    raise exception 'Fuel use must be between 10 and 80 litres per 100 km.' using errcode = '22023';
  end if;
  if _long_haul_markup is null or _long_haul_markup < 1 or _long_haul_markup > 3 then
    raise exception 'The long-haul allowance must be between 1 and 3.' using errcode = '22023';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  select jsonb_object_agg(key, value) into _old from public.system_settings
   where key in ('fuel_l_per_100km', 'long_haul_markup');
  insert into public.system_settings (key, value, updated_by, updated_at)
  values ('fuel_l_per_100km', to_jsonb(_fuel_l_per_100km), auth.uid(), now()),
         ('long_haul_markup', to_jsonb(_long_haul_markup), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.log_admin_action(
    _action => 'fuel_assumptions_changed',
    _meta => jsonb_build_object('fuel_l_per_100km', _fuel_l_per_100km,
                                'long_haul_markup', _long_haul_markup, 'previous', coalesce(_old, '{}'::jsonb)),
    _reason => btrim(_reason));
  return jsonb_build_object('fuel_l_per_100km', _fuel_l_per_100km, 'long_haul_markup', _long_haul_markup);
end $$;
revoke all on function public.admin_set_fuel_assumptions(numeric, numeric, text) from public, anon;
grant execute on function public.admin_set_fuel_assumptions(numeric, numeric, text) to authenticated;

commit;
