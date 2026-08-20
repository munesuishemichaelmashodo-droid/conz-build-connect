-- 0041: reference-truck trip-aware pricing for Mode C (>20 m3), plus
-- low/recommended/high exposure, pricing_version and pricing_breakdown
-- auditability on jobs.
--
-- Context: at quote time there is no selected driver/truck yet (customer
-- posts -> Con Z quotes -> drivers bid -> customer picks). The existing
-- `trucks` table is driver-owned/self-reported and is never joined to
-- pricing. This migration does NOT change that -- it uses a 10 m3
-- REFERENCE capacity purely to estimate trip count for large orders. This
-- is explicitly an estimate, not the eventual driver's real truck.
--
-- Core fix: Mode C (>20 m3) previously charged the single-trip transport
-- band (e.g. $60 for 30-50km) regardless of quantity, and fell back to
-- "requiresCustomQuote: true" whenever fewer than 3 comparable historical
-- bids existed -- which is effectively always, since Con Z has only ~4
-- completed jobs total. That meant large orders almost never got an
-- automatic price. This migration:
--   1. Adds trip_count = CEILING(quantity / 10) for Mode C, using numeric
--      (exact decimal) arithmetic -- no floating-point epsilon risk.
--   2. Multiplies the transport component by trip_count, so 30/40/50 m3
--      orders are no longer undercharged for transport.
--   3. Replaces the "requiresCustomQuote" dead-end (no market data path)
--      with a real computed price: the same per-m3 material rate used by
--      Mode A, extended linearly, plus trip-aware transport.
--   4. Keeps the market-data path when 3+ comparable historical bids exist,
--      now also trip-aware for its transport component.
-- Modes A and B are untouched.

-- 1. Auditability columns on jobs. Nullable, no backfill -- historical jobs
-- keep no pricing_version/breakdown rather than being falsely stamped.
alter table public.jobs
  add column if not exists pricing_version text,
  add column if not exists pricing_breakdown jsonb;

-- 2. Rewrite compute_material_offer: Mode C becomes trip-aware; all modes
-- gain low/recommended/high aliases (low=min, recommended=offer, high=max)
-- and tripCount/referenceCapacityM3/pricingVersion fields for the UI and
-- for storing into pricing_breakdown. min/max/offer/enforced keys are left
-- exactly as before since tg_validate_job_budget reads them directly.
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

  -- MODE A: small load, quantity under 1m3 (unchanged)
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

  -- MODE B: 1m3 to 20m3, bucket rounding (unchanged)
  select * into _bucket
  from public.material_price_buckets
  where material = _material and bucket_m3 >= _qty
  order by bucket_m3 asc
  limit 1;

  if _bucket is null then
    -- MODE C: over largest bucket (>20 m3). Trip-aware: a 10 m3 REFERENCE
    -- truck is used purely to estimate how many physical trips this order
    -- would take. This is an estimate for display/pricing purposes only --
    -- the actual driver's truck capacity is not known until a bid is
    -- accepted. Exact numeric division/CEIL, so no float epsilon risk at
    -- boundaries like exactly 30.00 m3.
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
      -- Known limitation: market_price_per_m3 is derived from historical
      -- accepted bid totals, which may already implicitly bundle whatever
      -- transport the driver charged. Adding trip-aware transport on top
      -- is a deliberate simplification for now (documented, not hidden) --
      -- revisit once there's enough completed-job volume to separate the
      -- two empirically.
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

    -- No sufficient market data (the common case today): compute a real
    -- price instead of dead-ending into "requires custom quote". Uses the
    -- same per-m3 material rate as Mode A, extended linearly (consistent
    -- with how the bucket prices themselves were derived), plus
    -- trip-aware transport.
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

  -- Mode B body (unchanged)
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

-- 3. Stamp pricing_version + pricing_breakdown at job-creation time, inside
-- the existing budget-validation trigger (same source of truth the
-- customer was quoted from -- no second pricing engine introduced).
create or replace function public.tg_validate_job_budget()
returns trigger language plpgsql set search_path=public as $$
declare
  _mp public.material_prices;
  _distance_km numeric;
  _offer jsonb;
  _min numeric;
  _max numeric;
begin
  select * into _mp from public.material_prices where material = new.material;
  if _mp is null or not _mp.enforced then return new; end if;
  if new.budget is null then return new; end if;

  if new.pickup_lat is not null and new.pickup_lng is not null
     and new.delivery_lat is not null and new.delivery_lng is not null then
    _distance_km := 2 * 6371 * asin(sqrt(
      power(sin(radians(new.delivery_lat - new.pickup_lat) / 2), 2) +
      cos(radians(new.pickup_lat)) * cos(radians(new.delivery_lat)) *
      power(sin(radians(new.delivery_lng - new.pickup_lng) / 2), 2)
    ));
  else
    _distance_km := 15;
  end if;

  _offer := public.compute_material_offer(new.material, new.quantity_m3, _distance_km);

  if (_offer->>'enforced')::boolean is not true then return new; end if;
  if _offer->>'min' is null or _offer->>'max' is null then return new; end if;

  _min := (_offer->>'min')::numeric;
  _max := (_offer->>'max')::numeric;

  if new.budget < _min or new.budget > _max then
    raise exception 'Budget $% is outside the allowed range for % ($%-$% for % m³ at ~%km)',
      new.budget, _mp.label, _min, _max, new.quantity_m3, round(_distance_km);
  end if;

  new.pricing_version := _offer->>'pricingVersion';
  new.pricing_breakdown := jsonb_build_object(
    'quantity_m3', new.quantity_m3,
    'distance_km', round(_distance_km, 1),
    'trip_count', coalesce((_offer->>'tripCount')::int, 1),
    'reference_capacity_m3', coalesce((_offer->>'referenceCapacityM3')::numeric, 10),
    'material_component', (_offer->>'materialCost')::numeric,
    'transport_component', (_offer->>'transportCost')::numeric,
    'low', _min,
    'recommended', (_offer->>'offer')::numeric,
    'high', _max,
    'data_source', coalesce(_offer->>'dataSource', _offer->>'mode', _offer->>'bucketM3'::text, 'bucket')
  );

  return new;
end $$;
