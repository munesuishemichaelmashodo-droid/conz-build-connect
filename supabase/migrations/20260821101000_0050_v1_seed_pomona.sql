-- V1 seed: exactly one VERIFIED real material supply location.
-- Pomona Stone Quarries, Alpes Road, Pomona, Harare -- established 1951,
-- address confirmed across 5+ independent sources (own site + directories),
-- coordinates from a Google Plus Code (736F+P67) tied to their own
-- business listing, decoded via Google's official open-source algorithm,
-- cross-validated within ~200m of an independent geocoder.
--
-- This is a research/geographic seed for V1 pricing, not a claim of
-- commercial partnership or onboarding with Pomona Stone Quarries.
--
-- Materials mapped only to what their own site explicitly states
-- ("Crushed Granite" / "quarry dust to boulders"): crusher_run,
-- quarry_dust, stones. Gravel deliberately NOT included -- not
-- explicitly confirmed as a distinct product.
--
-- available_quantity_m3 left NULL: inventory is not tracked for this
-- seed source; it remains eligible regardless of order quantity.

do $$
declare
  _supplier_id uuid;
begin
  insert into public.suppliers (name, verification_status, notes)
  values (
    'Pomona Stone Quarries',
    'verified',
    'V1 geographic/material-source seed data for ConZ''s pricing calculator. Not a claim of commercial partnership or onboarding.'
  )
  returning id into _supplier_id;

  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority)
  values
    (_supplier_id, 'crusher_run', 'quarry', 'Pomona Stone Quarries', 'Alpes Road, Pomona, Harare', -17.7382125, 31.073046875, 'active', 'verified', null, 100),
    (_supplier_id, 'quarry_dust', 'quarry', 'Pomona Stone Quarries', 'Alpes Road, Pomona, Harare', -17.7382125, 31.073046875, 'active', 'verified', null, 100),
    (_supplier_id, 'stones',      'quarry', 'Pomona Stone Quarries', 'Alpes Road, Pomona, Harare', -17.7382125, 31.073046875, 'active', 'verified', null, 100);
end $$;
