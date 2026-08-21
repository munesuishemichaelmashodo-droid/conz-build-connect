-- 0051: supplier-specific geographic service-area eligibility.
--
-- Adds material_supply_locations.service_radius_km: a CONZ-CONFIGURED
-- ELIGIBILITY BOUNDARY, not a claim of what a supplier publicly advertises
-- as its delivery coverage. This distinction matters for any future
-- customer-facing copy: "configured supplier service area" is accurate,
-- "Pomona delivers within Xkm" is not (no such claim has been confirmed by
-- Pomona) -- kept explicit here as documentation for whoever writes that
-- copy later.
--
-- NULL semantics are intentionally FAIL-CLOSED, not "unlimited": a source
-- with no configured radius is NOT eligible. This is why the column add,
-- Pomona's backfill, and the resolver enforcement are all applied in this
-- single migration -- there must never be a live window where the
-- resolver enforces the radius while Pomona (or any other existing
-- verified source) still has NULL, which would silently break Harare's
-- currently-working resolution.
--
-- Radius is configured per material_supply_locations row, not per
-- supplier: a supplier's different products/sites may reasonably need
-- different service areas (see the earlier design report).
--
-- Approved policy value for Pomona: 40km. This is a ConZ eligibility
-- decision derived from a geographic analysis (Harare/Chitungwiza/Ruwa/
-- Goromonzi fall inside; Marondera/Murehwa/Macheke fall outside) -- it is
-- not sourced from any Pomona-published delivery-radius claim.
--
-- Does not touch compute_material_offer, getRoute, quote_id/price_quotes,
-- pricing triggers, driver matching, or booking logic. Only
-- resolve_material_source_candidates' WHERE clause changes.

alter table public.material_supply_locations
  add column if not exists service_radius_km numeric
    check (service_radius_km is null or service_radius_km > 0);

comment on column public.material_supply_locations.service_radius_km is
  'ConZ-configured geographic eligibility boundary for this supply location, in km, applied as a haversine-distance cutoff during source-candidate resolution. NOT a claim that the supplier publicly advertises delivery within this distance -- purely an internal eligibility policy. NULL is fail-closed: a source with no configured radius is not eligible for any delivery (see migration 0051).';

-- Backfill: Pomona's three existing verified rows, approved policy value.
update public.material_supply_locations
set service_radius_km = 40
where supplier_id = (select id from public.suppliers where name = 'Pomona Stone Quarries')
  and material in ('crusher_run', 'quarry_dust', 'stones');

-- Resolver: same function, same signature, one added filter condition.
-- Uses the identical haversine formula already computed for ranking --
-- no new distance calculation introduced, just an additional bound on
-- the existing one.
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
  'Eligibility filter + straight-line pre-filter only (no OSRM/HTTP). Requires service_radius_km to be explicitly set (fail-closed on NULL) and the source to be within that radius of the delivery point. The TypeScript resolution layer calls this, then calls getRoute for the returned candidates to rank by real road distance. Never returns on_demand_source rows, unverified/inactive/insufficient-quantity locations, or sources with no configured or exceeded service radius.';
