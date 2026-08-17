-- 0040: small-load pricing engine (Mode A/B/C)
-- Applied live via Supabase MCP on 2026-08-17. This file is the checked-in
-- record so the repo's migration history matches the live database.

-- 1. Small-load settings table
create table public.small_load_settings (
  material material_category primary key references public.material_prices(material),
  minimum_trip_charge numeric not null,
  min_quantity_m3 numeric not null default 0.1,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.small_load_settings enable row level security;

create policy "small_load_settings_select_all"
  on public.small_load_settings for select
  using (true);

create policy "small_load_settings_admin_write"
  on public.small_load_settings for all
  using (has_role(auth.uid(), 'super_admin'::app_role))
  with check (has_role(auth.uid(), 'super_admin'::app_role));

insert into public.small_load_settings (material, minimum_trip_charge) values
  ('gravel', 25),
  ('pit_sand', 22),
  ('river_sand', 28),
  ('quarry_dust', 27),
  ('crusher_run', 32),
  ('stones', 35),
  ('top_soil', 22),
  ('filling_soil', 25);

-- 2. 5m3 bucket tier
insert into public.material_price_buckets (material, bucket_m3, min_price, max_price) values
  ('river_sand', 5, 60, 80),
  ('pit_sand', 5, 40, 55),
  ('quarry_dust', 5, 50, 90),
  ('crusher_run', 5, 90, 125),
  ('gravel', 5, 45, 65),
  ('stones', 5, 75, 150),
  ('top_soil', 5, 40, 80),
  ('filling_soil', 5, 56, 84);

-- 3. Replace compute_material_offer with mode A/B/C branching + closed custom-material loophole
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
begin
  select * into _mp from public.material_prices where material = _material;
  if _mp is null or not _mp.enforced then
    return jsonb_build_object(
      'offer', null, 'min', null, 'max', null, 'step', 5,
      'enforced', false, 'requiresCustomQuote', true,
      'label', coalesce(_mp.label, initcap(replace(_material::text, '_', ' '))),
      'unit', coalesce(_mp.unit, '')
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

  -- MODE A: small load, quantity under 1m3
  if _qty < 1 then
    select * into _small from public.small_load_settings where material = _material;

    if _small is null or not _small.enabled then
      return jsonb_build_object(
        'offer', null, 'min', null, 'max', null, 'step', 5,
        'enforced', true, 'requiresCustomQuote', true,
        'label', _mp.label, 'unit', _mp.unit
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
      'step', _step,
      'label', _mp.label,
      'unit', _mp.unit,
      'enforced', true,
      'materialCost', round(_material_component, 2),
      'transportCost', round(_transport, 2),
      'mode', 'small_load'
    );
  end if;

  -- MODE B: 1m3 to 20m3, bucket rounding (now includes 5m3 tier)
  select * into _bucket
  from public.material_price_buckets
  where material = _material and bucket_m3 >= _qty
  order by bucket_m3 asc
  limit 1;

  if _bucket is null then
    -- MODE C: over largest bucket, try real market data first
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
        'step', _step,
        'label', _mp.label,
        'unit', _mp.unit,
        'enforced', true,
        'materialCost', round(_material_component, 2),
        'transportCost', round(_transport, 2),
        'dataSource', 'market',
        'sampleSize', _market_sample_count
      );
    end if;

    return jsonb_build_object(
      'offer', null, 'min', null, 'max', null, 'step', 5,
      'label', _mp.label, 'unit', _mp.unit, 'enforced', true,
      'requiresCustomQuote', true,
      'sampleSize', coalesce(_market_sample_count, 0)
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
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true,
    'materialCost', round(_material_component, 2),
    'transportCost', round(_transport, 2),
    'bucketM3', _bucket.bucket_m3
  );
end
$function$;
