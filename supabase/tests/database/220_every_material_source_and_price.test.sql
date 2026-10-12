-- Every selectable material (the 9 values of material_category) must behave predictably:
--   * priced by compute_material_offer (custom -> explicit custom-quote path, never a number)
--   * sourced ONLY from a verified supplier at an exact, active, in-radius location with tracked
--     stock >= the order (capacity check); anything else resolves to NO candidate (-> the app
--     records a sourcing request instead of inventing a pickup).
-- Fixtures are created inside this test; no real supplier data is read or invented.

begin;
select plan(9 + 9 + 4 + 4);

create temp table t_mat on commit drop as
  select m::material_category as material from unnest(enum_range(null::material_category)::text[]) m;

-- Fixture supplier + one eligible location per material, ~5 km from the delivery point.
insert into public.suppliers (id, name, verification_status) values ('00000000-0000-0000-0000-0000000000a1', 'FIXTURE verified supplier', 'verified');
insert into public.suppliers (id, name, verification_status) values ('00000000-0000-0000-0000-0000000000a2', 'FIXTURE unverified supplier', 'unverified');
insert into public.material_supply_locations
  (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
select '00000000-0000-0000-0000-0000000000a1', material, 'quarry', 'FIXTURE ' || material, 'fixture', -17.80, 31.05, 'active', 'verified', 50, 100, 40, 'exact'
  from t_mat where material <> 'custom';

-- 1. Pricing for every material
select is((public.compute_material_offer(material, 12, 25)->>'offer') is not null and ((public.compute_material_offer(material, 12, 25)->>'offer')::numeric > 0),
          material <> 'custom', 'price: ' || material || case when material = 'custom' then ' has no automatic price' else ' is priced' end)
  from t_mat order by material::text;

-- 2. Sourcing for every material at a delivery point 5 km away, 12 m3
select is((select count(*)::int from public.resolve_material_source_candidates(material, 12, -17.8292, 31.0522) where supplier_id = '00000000-0000-0000-0000-0000000000a1'),
          case when material = 'custom' then 0 else 1 end,
          'source: ' || material || case when material = 'custom' then ' has no verified location' else ' resolves to the verified exact location' end)
  from t_mat order by material::text;

-- 3. Capacity, radius, verification and precision guards
select is((select count(*)::int from public.resolve_material_source_candidates('river_sand', 60, -17.8292, 31.0522) where supplier_id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'capacity: 60 m3 is STILL offered when only 50 m3 is tracked (0101: stock is advisory, never a gate)');
select is((select count(*)::int from public.resolve_material_source_candidates('river_sand', 12, -20.15, 28.58)), 0,
  'radius: a delivery ~370 km away is outside the 40 km service radius');
update public.material_supply_locations set verification_status = 'unverified' where material = 'pit_sand' and supplier_id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.resolve_material_source_candidates('pit_sand', 12, -17.8292, 31.0522)), 0,
  'verification: an unverified location is never offered');
update public.material_supply_locations set location_precision = 'regional' where material = 'gravel';
select is((select count(*)::int from public.resolve_material_source_candidates('gravel', 12, -17.8292, 31.0522)), 0,
  'precision: a regional (approximate) location is never offered');

-- 4. Untracked stock is advisory (0101); unverified supplier / paused location still fail closed
update public.material_supply_locations set available_quantity_m3 = null where material = 'top_soil';
select is((select count(*)::int from public.resolve_material_source_candidates('top_soil', 1, -17.8292, 31.0522) where supplier_id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'stock: a location with untracked (NULL) stock IS eligible (0101); it is labelled unknown, never confirmed');
update public.material_supply_locations set supplier_id = '00000000-0000-0000-0000-0000000000a2' where material = 'filling_soil';
select is((select count(*)::int from public.resolve_material_source_candidates('filling_soil', 12, -17.8292, 31.0522)), 0,
  'supplier: a location of an unverified supplier is not eligible');
update public.material_supply_locations set status = 'paused' where material = 'stones';
select is((select count(*)::int from public.resolve_material_source_candidates('stones', 12, -17.8292, 31.0522)), 0,
  'status: a paused location is not eligible');
select is((select count(*)::int from public.resolve_material_source_candidates('crusher_run', 50, -17.8292, 31.0522) where supplier_id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'capacity: an order equal to the tracked stock is eligible');

select * from finish();
rollback;
