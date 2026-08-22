-- V1 national expansion: second VERIFIED real material supply location.
-- Davis Granite, Khami Road, Bulawayo -- coordinates from an OSM
-- landuse=quarry polygon with operator="Davies Granite" attribution,
-- cross-validated via an independently decoded Plus Code (~10m agreement).
--
-- This is a research/geographic seed for pricing, not a claim of
-- commercial partnership or onboarding with Davis Granite.
--
-- Materials mapped only to what's explicitly evidenced for this site:
-- crusher_run, stones. Not extending to gravel/sand/other Davis Granite
-- products sold at other quarries -- no evidence they're produced here.
--
-- service_radius_km = 25: conservative choice. Real geocoded points for
-- every named Bulawayo suburb (Nketa, Hillside, Bradfield/Hillside area)
-- cluster within 4.6-7.1km of this quarry -- 25km gives comfortable
-- margin over all of them. Deliberately excludes Esigodini (44.4km, a
-- real separate town) and Gwanda (100.1km) -- extending coverage to
-- either is a distinct future business decision, not bundled into this
-- seed.
--
-- available_quantity_m3 left NULL: untracked, not invented.

do $$
declare
  _supplier_id uuid;
begin
  insert into public.suppliers (name, verification_status, notes)
  values (
    'Davis Granite',
    'verified',
    'V1 geographic/material-source seed data for ConZ''s pricing calculator. Not a claim of commercial partnership or onboarding.'
  )
  returning id into _supplier_id;

  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km)
  values
    (_supplier_id, 'crusher_run', 'quarry', 'Davis Granite Bulawayo Quarry', 'Khami Road, Bulawayo', -20.15973, 28.53636, 'active', 'verified', null, 100, 25),
    (_supplier_id, 'stones',      'quarry', 'Davis Granite Bulawayo Quarry', 'Khami Road, Bulawayo', -20.15973, 28.53636, 'active', 'verified', null, 100, 25);
end $$;
