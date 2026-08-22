-- 0053: Supply Coverage Dashboard backend.
--
-- Two additive pieces, neither touched by the pricing/resolver/booking
-- pipeline:
--
-- 1. supply_research_candidates: a small, explicitly non-authoritative
--    reference table for MEDIUM/LOW-confidence research candidates
--    (Davis Granite/Theydon, Taguta Stone Crushers, etc.) so the dashboard
--    can show the GREY state without inventing fake material_supply_locations
--    rows. NOT read by resolve_material_source_candidates, resolveMaterialSource,
--    or any pricing code -- admin-dashboard display only.
--
-- 2. admin_supply_coverage(): a SECURITY DEFINER reporting function that
--    reuses resolve_material_source_candidates verbatim (called once per
--    material x reporting-region combination) rather than re-implementing
--    the eligibility/distance formula -- guarantees the dashboard can never
--    disagree with production resolution, since it's calling the exact
--    same function every real quote uses.
--
-- The 18 "reporting regions" below are fixed reference coordinates for
-- dashboard grouping/display ONLY -- they are not read by the resolver,
-- not a source-selection rule, and adding/removing a region here has zero
-- effect on how a real customer's delivery coordinates are resolved.

create table if not exists public.supply_research_candidates (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  physical_source_description text,
  region_label text not null,
  materials text[] not null default '{}',
  confidence text not null check (confidence in ('medium', 'low')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.supply_research_candidates is
  'Explicitly non-authoritative research reference for the Supply Coverage Dashboard (GREY state) only. Never read by resolve_material_source_candidates, resolveMaterialSource, compute_material_offer, or any pricing/booking code -- inserting a row here has zero effect on what a customer can order or what price they see. Promote to a real material_supply_locations row (with a genuinely verified coordinate) once a candidate reaches HIGH confidence.';

alter table public.supply_research_candidates enable row level security;

drop policy if exists "Admins manage research candidates" on public.supply_research_candidates;
create policy "Admins manage research candidates" on public.supply_research_candidates
  for all using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));

insert into public.supply_research_candidates (supplier_name, physical_source_description, region_label, materials, confidence, notes)
values
  ('Davis Granite', 'Theydon Farm / Theydon Siding, off Theydon Road (A3, ~15.5km east of Marondera)', 'Marondera / Macheke',
   array['crusher_run','stones','quarry_dust'], 'medium',
   'Real, well-corroborated operation (rail siding for stone export documented). Exact quarry coordinate not established to production standard -- nearest anchor is Bernard Mizeki College (co-signposted on the same road), not the quarry itself. See research history for full evidence trail.'),
  ('Taguta Stone Crushers', 'Outskirts of Mutare, Mutare-Chimanimani Highway', 'Mutare',
   array['river_sand','stones'], 'medium',
   'Real, recently-established operation (~US$2M investment, reported June 2025, named staff). No landmark-level location precision found.');

create or replace function public.admin_supply_coverage()
returns table (
  region_label text,
  region_lat numeric,
  region_lng numeric,
  material text,
  status text,
  nearest_supplier_name text,
  nearest_distance_km numeric,
  nearest_radius_km numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _is_admin boolean;
begin
  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if not _is_admin then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  return query
  with regions(region_label, region_lat, region_lng) as (
    values
      ('Harare', -17.8292, 31.0522),
      ('Chitungwiza', -17.9939, 31.0481),
      ('Ruwa', -17.8902, 31.2434),
      ('Goromonzi', -17.8550, 31.3758),
      ('Marondera', -18.1897, 31.5467),
      ('Macheke', -18.1208, 31.8561),
      ('Mutare', -18.9707, 32.6709),
      ('Rusape', -18.5350, 32.1272),
      ('Gweru', -19.4500, 29.8167),
      ('Kwekwe', -18.9170, 29.8170),
      ('Kadoma', -18.3400, 29.9000),
      ('Bulawayo', -20.1500, 28.5833),
      ('Gwanda', -20.9333, 29.0000),
      ('Hwange', -18.3667, 26.5000),
      ('Masvingo', -20.0625, 30.8236),
      ('Chinhoyi', -17.3667, 30.2000),
      ('Bindura', -17.3019, 31.3306),
      ('Beitbridge', -22.2167, 30.0000)
  ),
  materials(material) as (
    values ('crusher_run'), ('quarry_dust'), ('stones'), ('gravel'),
           ('river_sand'), ('pit_sand'), ('top_soil'), ('filling_soil'), ('custom')
  )
  select
    r.region_label,
    r.region_lat,
    r.region_lng,
    m.material,
    case
      when exists (
        select 1 from public.resolve_material_source_candidates(m.material::material_category, 1, r.region_lat, r.region_lng)
      ) then 'green'
      when exists (select 1 from public.material_supply_locations msl where msl.material = m.material::material_category) then 'amber'
      else 'red'
    end as status,
    nearest.supplier_name,
    nearest.distance_km,
    nearest.radius_km
  from regions r
  cross join materials m
  left join lateral (
    select s.name as supplier_name,
      round((2 * 6371 * asin(sqrt(
        power(sin(radians(r.region_lat - msl.lat) / 2), 2) +
        cos(radians(msl.lat)) * cos(radians(r.region_lat)) *
        power(sin(radians(r.region_lng - msl.lng) / 2), 2)
      )))::numeric, 1) as distance_km,
      msl.service_radius_km as radius_km
    from public.material_supply_locations msl
    join public.suppliers s on s.id = msl.supplier_id
    where msl.material = m.material::material_category
      and msl.lat is not null and msl.lng is not null
    order by (2 * 6371 * asin(sqrt(
        power(sin(radians(r.region_lat - msl.lat) / 2), 2) +
        cos(radians(msl.lat)) * cos(radians(r.region_lat)) *
        power(sin(radians(r.region_lng - msl.lng) / 2), 2)
      )))
    limit 1
  ) nearest on true
  order by r.region_label, m.material;
end;
$function$;

comment on function public.admin_supply_coverage is
  'Supply Coverage Dashboard backend. Reuses resolve_material_source_candidates verbatim for the GREEN/eligibility determination (never re-implements the formula) -- calls it once per region x material. Admin/super_admin only, enforced inside the function (SECURITY DEFINER + explicit role check), independent of any RLS on the underlying tables. Read-only, no side effects. The 18 region coordinates are dashboard reporting groupings only, not a source-resolution rule -- resolve_material_source_candidates itself never sees a region name, only the raw lat/lng passed to it here, identical to how it is called for a real customer quote.';

grant execute on function public.admin_supply_coverage() to authenticated;
