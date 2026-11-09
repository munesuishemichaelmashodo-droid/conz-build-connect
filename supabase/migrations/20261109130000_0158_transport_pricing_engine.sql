-- 0158: transport-only pricing engine (design: docs/marketplace/CONZ-NATIONWIDE-PRICING.md). ADDITIVE and OFF.
--
-- * compute_transport_offer(road_km, quantity_m3): the transport fare for a load going from the client's pickup point to the
--   delivery point by ROAD. No material price, no supplier, no default distance: bad input is refused. Same bands and fuel
--   settings as the current engine (flat to 50 km, then fuel-based), same -15% / +15% guide spread. Every value it returns is
--   marked uncalibrated; it never writes a setting or a price.
-- * system_settings 'transport_pricing_enabled' = false. NOTHING calls the function yet and no job uses it. Turning the
--   switch on is an owner decision (it changes what commission is charged on).
-- * jobs.pricing_basis records which engine priced a job; every existing job stays 'legacy_material_plus_transport'.
-- No DROP. Undo: supabase/rollbacks/20261109130000_0158_rollback.sql.

insert into public.system_settings (key, value)
values ('transport_pricing_enabled', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.jobs add column if not exists pricing_basis text not null default 'legacy_material_plus_transport'
  check (pricing_basis in ('legacy_material_plus_transport', 'transport_only'));

create or replace function public.compute_transport_offer(_road_km numeric, _quantity_m3 numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  _diesel numeric;
  _fuel numeric;
  _allow numeric;
  _rate numeric;
  _trips integer;
  _per_trip numeric;
  _enabled boolean;
begin
  if _road_km is null or _road_km <= 0 or _road_km > 2000 then
    raise exception 'A road distance between 0 and 2000 km is needed to price a delivery.' using errcode = '22023';
  end if;
  if _quantity_m3 is null or _quantity_m3 <= 0 or _quantity_m3 > 1000 then
    raise exception 'A load size between 0 and 1000 m3 is needed to price a delivery.' using errcode = '22023';
  end if;

  select case when (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into _diesel from public.system_settings where key = 'diesel_price_per_liter';
  if _diesel is null or _diesel <= 0 or _diesel > 100 then _diesel := 2.04; end if;
  select case when (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into _fuel from public.system_settings where key = 'fuel_l_per_100km';
  if _fuel is null or _fuel < 10 or _fuel > 80 then _fuel := 32; end if;
  select case when (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' then (value #>> '{}')::numeric end
    into _allow from public.system_settings where key = 'long_haul_markup';
  if _allow is null or _allow < 1 or _allow > 3 then _allow := 1.87; end if;
  _rate := (_fuel / 100) * _diesel * _allow;

  _per_trip := case
    when _road_km <= 10 then 20
    when _road_km <= 20 then 30
    when _road_km <= 30 then 40
    when _road_km <= 50 then 60
    else 60 + (_road_km - 50) * _rate
  end;
  _trips := ceil(_quantity_m3 / 20.0)::integer;

  select coalesce((select (value #>> '{}') = 'true' from public.system_settings where key = 'transport_pricing_enabled'), false)
    into _enabled;

  return jsonb_build_object(
    'basis', 'transport_only',
    'enabled', _enabled,
    'calibration', 'uncalibrated',
    'roadKm', _road_km,
    'trips', _trips,
    'perTrip', jsonb_build_object(
      'low', round(_per_trip * 0.85, 2), 'recommended', round(_per_trip, 2), 'high', round(_per_trip * 1.15, 2)),
    'total', jsonb_build_object(
      'low', round(_per_trip * 0.85 * _trips, 2), 'recommended', round(_per_trip * _trips, 2),
      'high', round(_per_trip * 1.15 * _trips, 2)),
    'assumptions', jsonb_build_object(
      'referenceTruckM3', 20, 'dieselPricePerLitre', _diesel, 'fuelLitresPer100km', _fuel,
      'allowance', _allow, 'ratePerKmBeyond50', round(_rate, 4),
      'note', 'Estimate for a car-profile road route; confirm suitability for a loaded truck. Not a quote.')
  );
end $$;
revoke all on function public.compute_transport_offer(numeric, numeric) from public, anon;
grant execute on function public.compute_transport_offer(numeric, numeric) to authenticated, service_role;
