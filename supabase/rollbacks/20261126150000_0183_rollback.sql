-- Undo 0183. Restores find_next_loads_for_driver exactly as live on 26/11/2026, and the previous
-- mask_job_for_driver, with ONE deliberate difference: the mask keeps removing collection_contact and
-- collection_reference, and it keeps showing only an area for a customer-chosen collection point
-- (pricing_basis 'transport_only' or 'transport_request'). Those columns and the 'transport_request' value did not
-- exist before 0183, and any job posted while 0183 was live may hold them; restoring the bare previous body would
-- show them to drivers who were not selected. The wider pricing_basis constraint stays (existing rows may use it).
-- The validation trigger becomes a pass-through (removing it would need DROP). The new columns stay (no DROP);
-- they are nullable and ignored by the app once it is rolled back.

create or replace function public.tg_validate_job_kind()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.mask_job_for_driver(j jobs)
 RETURNS jobs
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  j.delivery_address := public.coarse_place(j.delivery_address);
  j.delivery_lat := public.coarse_coord(j.delivery_lat);
  j.delivery_lng := public.coarse_coord(j.delivery_lng);
  j.dropoff_address := null; j.dropoff_lat := null; j.dropoff_lng := null;
  j.notes := public.redact_contacts(j.notes);
  j.receiver_name := null;
  j.tracking_token := null;
  j.delivery_pin := null;
  j.delivery_photo_url := null; j.pickup_photo_url := null;
  j.collection_contact := null; j.collection_reference := null;  -- kept from 0183, see header
  if j.pricing_basis in ('transport_only', 'transport_request') then  -- kept from 0183, see header
    j.pickup_address := public.coarse_place(j.pickup_address);
    j.pickup_lat := public.coarse_coord(j.pickup_lat);
    j.pickup_lng := public.coarse_coord(j.pickup_lng);
  end if;
  return j;
end $function$;

CREATE OR REPLACE FUNCTION public.find_next_loads_for_driver(_driver_id uuid, _current_job_id uuid)
 RETURNS TABLE(job_id uuid, material material_category, quantity_m3 numeric, pickup_address text, pickup_lat double precision, pickup_lng double precision, delivery_address text, delivery_lat double precision, delivery_lng double precision, budget numeric, preferred_date date, repositioning_km numeric, next_load_km numeric, empty_km_saved numeric, capacity_tier text, capacity_trips integer, recommendation_tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.job_id, e.material, e.quantity_m3, e.pickup_address, e.pickup_lat, e.pickup_lng,
         public.coarse_place(e.delivery_address), public.coarse_coord(e.delivery_lat), public.coarse_coord(e.delivery_lng),
         e.budget, e.preferred_date, e.repositioning_km, e.next_load_km, e.empty_km_saved, e.capacity_tier,
         e.capacity_trips, e.recommendation_tier
    from public._find_next_loads_exact(_driver_id, _current_job_id) e
$function$;
