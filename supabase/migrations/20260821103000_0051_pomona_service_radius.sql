-- 0051: fail-closed service-radius eligibility for material sources.
--
-- Approved business decision: Pomona Stone Quarries' ConZ operational
-- service radius = 40km. This is a ConZ serviceability policy, not a
-- claim about Pomona's actual commercial delivery range.
--
-- All three steps (schema, data, resolver enforcement) are combined into
-- one migration deliberately, so there is never a live window where the
-- enforcing resolver exists while an active verified source still has
-- NULL service_radius_km -- that window would make Harare (the only
-- currently working city) resolve to nothing.

alter table public.material_supply_locations
  add column if not exists service_radius_km numeric
    check (service_radius_km is null or service_radius_km > 0);

update public.material_supply_locations
set service_radius_km = 40
where supplier_id = (select id from public.suppliers where name = 'Pomona Stone Quarries')
  and status = 'active'
  and verification_status = 'verified';

create or replace function public.resolve_material_source_candidates(
  _material public.material_category,
  _quantity_m3 numeric,
  _delivery_lat numeric,
  _delivery_lng numeric
) returns table (
  supply_location_id uuid,
  supplier_id uuid,
  supplier_name text,
  source_type text,
  label text,
  address text,
  lat numeric,
  lng numeric,
  priority int,
  haversine_km numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    msl.id,
    msl.supplier_id,
    s.name,
    msl.source_type,
    msl.label,
    msl.address,
    msl.lat,
    msl.lng,
    msl.priority,
    round((2 * 6371 * asin(sqrt(
      power(sin(radians(_delivery_lat - msl.lat) / 2), 2) +
      cos(radians(msl.lat)) * cos(radians(_delivery_lat)) *
      power(sin(radians(_delivery_lng - msl.lng) / 2), 2)
    )))::numeric, 2) as haversine_km
  from public.material_supply_locations msl
  join public.suppliers s on s.id = msl.supplier_id
  where msl.material = _material
    and msl.status = 'active'
    and msl.verification_status = 'verified'
    and msl.lat is not null
    and msl.lng is not null
    and (msl.available_quantity_m3 is null or msl.available_quantity_m3 >= _quantity_m3)
    and msl.service_radius_km is not null
    and (2 * 6371 * asin(sqrt(
          power(sin(radians(_delivery_lat - msl.lat) / 2), 2) +
          cos(radians(msl.lat)) * cos(radians(_delivery_lat)) *
          power(sin(radians(_delivery_lng - msl.lng) / 2), 2)
        ))) <= msl.service_radius_km
  order by haversine_km asc
  limit 5;
$$;

comment on function public.resolve_material_source_candidates is
  'Eligibility filter + straight-line pre-filter only (no OSRM/HTTP). Fail-closed on service_radius_km: NULL means not eligible for automatic resolution, not "unlimited" -- a source needs an explicit, positive, approved service radius before it can resolve. The TypeScript resolution layer calls this, then calls getRoute for the returned candidates to rank by real road distance. Never returns on_demand_source rows (null lat/lng) or unverified/inactive/insufficient-quantity/out-of-service-radius locations.';

comment on column public.material_supply_locations.service_radius_km is
  'ConZ operational serviceability boundary for this specific material_supply_location row, in km straight-line (haversine) distance. NULL means this row is not eligible for automatic source resolution -- fail-closed by explicit design decision, not "unlimited service". Must be a deliberately approved business value, never invented. A source with rows outside their radius produces source_resolution_failed, not no_source_configured.';
