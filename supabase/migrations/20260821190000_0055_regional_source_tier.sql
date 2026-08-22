-- 0055: two-tier source-location model (EXACT / REGIONAL).
--
-- Adds material_supply_locations.location_precision: 'exact' (coordinates
-- independently verified against the actual physical site -- Pomona and
-- Bulawayo's existing rows) vs 'regional' (supplier/market presence
-- confirmed, coordinates are the strongest available reference point but
-- NOT the verified quarry/depot gate). Defaults to 'exact' so nothing
-- about the two already-shipped exact sources changes.
--
-- resolve_material_source_candidates gains one new output column
-- (location_precision) so the TypeScript resolution layer can apply a
-- conservative pricing-distance buffer for regional sources -- the
-- eligibility/service-radius check itself is completely unchanged, still
-- based on the honest unbuffered distance. This is the one resolver
-- change genuinely needed for this feature; nothing else about the
-- function's logic is touched.
--
-- Seeds four new REGIONAL Davis Granite material_supply_locations rows
-- (Gweru, Marondera, Gwanda, Hwange), reusing the existing Davis Granite
-- supplier row (one supplier, multiple physical sites -- same modeling
-- Pomona already uses for its three materials at one site). Each
-- coordinate is the strongest evidence-derived reference point already
-- established through this session's research, explicitly NOT presented
-- as an exact quarry gate:
--
--   Gweru:     -19.41425, 30.00943 -- derived from Davis Granite's own
--              stated "20km east of Gweru city centre on the main Mvuma
--              Road", projected along the real bearing between the real
--              Gweru roundabout and Mvuma junction coordinates.
--   Marondera: -18.10222, 31.64583 -- Bernard Mizeki College, a precise,
--              independently cross-validated anchor co-signposted with
--              Davis Granite on the same Theydon Road turnoff, NOT the
--              quarry itself.
--   Gwanda:    -20.93889, 29.01861 -- Gwanda town centre, used as a
--              proxy for "701 Hampden Jacaranda" (a specific in-town
--              stand address, bounded uncertainty).
--   Hwange:    -18.36472, 26.50000 -- Hwange town centre, used as a
--              proxy for "Sinamatella Road, Hwange" -- materially wider
--              uncertainty than the other three (no distance marker
--              found, and Sinamatella Road plausibly extends well
--              outside town toward Hwange National Park); flagged
--              explicitly in this row's notes, not silently treated as
--              equally confident.
--
-- Materials limited to crusher_run and stones for all four -- matching
-- exactly what's evidenced for Bulawayo (same company, same general
-- product line), not assuming quarry_dust/gravel/sand without
-- site-specific evidence.

alter table public.material_supply_locations
  add column if not exists location_precision text not null default 'exact'
    check (location_precision in ('exact', 'regional'));

comment on column public.material_supply_locations.location_precision is
  'exact: coordinates independently verified to correspond to the actual physical site. regional: supplier/market presence confirmed, coordinates are the strongest available reference point, NOT the verified gate -- gets a conservative distance buffer applied at pricing time (see resolveMaterialSource / REGIONAL_DISTANCE_BUFFER), never silently treated as exact.';

drop function if exists public.resolve_material_source_candidates(public.material_category, numeric, numeric, numeric);

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
  haversine_km numeric,
  location_precision text
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
    )))::numeric, 2) as haversine_km,
    msl.location_precision
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
  'Eligibility filter + straight-line pre-filter only (no OSRM/HTTP). Requires service_radius_km to be explicitly set (fail-closed on NULL) and the source to be within that radius of the delivery point, using the honest unbuffered distance regardless of location_precision. The TypeScript resolution layer calls this, then calls getRoute for the returned candidates to rank by real road distance, applying a conservative buffer to regional sources at that stage (not here). Never returns on_demand_source rows, unverified/inactive/insufficient-quantity locations, or sources with no configured or exceeded service radius.';

do $$
declare
  _davis_granite_id uuid;
begin
  select id into _davis_granite_id from public.suppliers where name = 'Davis Granite';

  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values
    (_davis_granite_id, 'crusher_run', 'quarry', 'Davis Granite Gweru (Premier Stonecrushers)', 'Mvuma Road, ~20km east of Gweru (regional reference -- see notes)', -19.41425, 30.00943, 'active', 'verified', null, 100, 30, 'regional'),
    (_davis_granite_id, 'stones',      'quarry', 'Davis Granite Gweru (Premier Stonecrushers)', 'Mvuma Road, ~20km east of Gweru (regional reference -- see notes)', -19.41425, 30.00943, 'active', 'verified', null, 100, 30, 'regional'),

    (_davis_granite_id, 'crusher_run', 'quarry', 'Davis Granite Marondera', 'Theydon Farm area, Marondera (regional reference -- see notes)', -18.10222, 31.64583, 'active', 'verified', null, 100, 30, 'regional'),
    (_davis_granite_id, 'stones',      'quarry', 'Davis Granite Marondera', 'Theydon Farm area, Marondera (regional reference -- see notes)', -18.10222, 31.64583, 'active', 'verified', null, 100, 30, 'regional'),

    (_davis_granite_id, 'crusher_run', 'depot', 'Davis Granite Gwanda', 'Gwanda (regional reference -- see notes)', -20.93889, 29.01861, 'active', 'verified', null, 100, 30, 'regional'),
    (_davis_granite_id, 'stones',      'depot', 'Davis Granite Gwanda', 'Gwanda (regional reference -- see notes)', -20.93889, 29.01861, 'active', 'verified', null, 100, 30, 'regional'),

    (_davis_granite_id, 'crusher_run', 'quarry', 'Davis Granite Hwange', 'Sinamatella Road, Hwange (regional reference -- wider uncertainty, see notes)', -18.36472, 26.50000, 'active', 'verified', null, 100, 30, 'regional'),
    (_davis_granite_id, 'stones',      'quarry', 'Davis Granite Hwange', 'Sinamatella Road, Hwange (regional reference -- wider uncertainty, see notes)', -18.36472, 26.50000, 'active', 'verified', null, 100, 30, 'regional');
end $$;
