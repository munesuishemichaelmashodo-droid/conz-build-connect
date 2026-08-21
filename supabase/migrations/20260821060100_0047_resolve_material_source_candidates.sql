-- Draft: pure SQL eligibility + pre-filter half of source resolution.
-- Returns up to 5 candidates ordered by straight-line distance for the
-- TypeScript layer to then re-rank by real road distance via getRoute.
-- No OSRM/HTTP here -- this function is STABLE and side-effect-free.

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
  order by haversine_km asc
  limit 5;
$$;

comment on function public.resolve_material_source_candidates is
  'Eligibility filter + straight-line pre-filter only (no OSRM/HTTP). The TypeScript resolution layer calls this, then calls getRoute for the returned candidates to rank by real road distance. Never returns on_demand_source rows (they have null lat/lng and are excluded by the lat/lng IS NOT NULL filter) or unverified/inactive/insufficient-quantity locations.';
