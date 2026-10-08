-- =============================================================================
-- 0080 — Pricing input integrity (audit P / F8: client-controlled pricing,
--        supply location, route distance, preferred driver)
-- =============================================================================
--
-- Problems (verified 08/10/2026):
--   * create_price_quote existed as two overloads, (text,numeric,numeric,text)
--     and (text,numeric,numeric,text,uuid DEFAULT NULL). Every 4-argument call
--     — the only kind the app makes — fails with "function ... is not unique",
--     which booking.functions.ts swallowed. Result (live): 0 of the last 9
--     jobs carried a quote, so budget validation always fell back to a
--     straight-line distance from the CLIENT-supplied pickup coordinate.
--   * Clients could call create_price_quote directly with any distance and any
--     supply location id.
--   * Client-chosen pickup / delivery coordinates were trusted for pricing; a
--     job with no delivery coordinates was priced at a default 15 km.
--   * preferred_driver_id was accepted unchecked (targeted spam / steering).
--
-- Fix:
--   1. Drop the ambiguous 4-arg overload; revoke client EXECUTE on
--      create_price_quote; add service-only create_price_quote_for(customer, …)
--      used by the booking server functions (quote bound to the customer and
--      to the server-resolved supply location).
--   2. tg_validate_job_budget: a CLIENT insert of a price-enforced material
--      must reference a valid, unexpired, unconsumed quote for the same
--      customer/material/quantity, and delivery coordinates; the pickup point
--      is set server-side (quote supply location -> material pickup ->
--      Harare default, the same fallback the app uses) — client pickup
--      coordinates are ignored. A quote whose distance no longer fits the
--      delivery coordinates is rejected rather than silently replaced.
--   3. jobs_guard_insert: coordinates must lie inside Zimbabwe (generous box;
--      all 74 live jobs checked inside); preferred_driver_id kept only if it is
--      a verified driver.
--
-- DEPLOY ORDER: ship the app (which now creates quotes successfully) BEFORE
-- applying this migration, otherwise bookings fail with "get a new quote".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quotes are server-created only
-- -----------------------------------------------------------------------------
drop function if exists public.create_price_quote(text, numeric, numeric, text);
revoke execute on function public.create_price_quote(text, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.create_price_quote(text, numeric, numeric, text, uuid) to service_role;

create or replace function public.create_price_quote_for(
  _customer_id uuid, _material text, _quantity_m3 numeric, _distance_km numeric,
  _distance_source text, _supply_location_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare _id uuid;
begin
  if _distance_km is null or not (_distance_km >= 0 and _distance_km <= 5000) then
    raise exception 'invalid_distance';
  end if;
  if not public.is_valid_money(_quantity_m3, 1000) then
    raise exception 'invalid_quantity';
  end if;
  if _distance_source not in ('osrm', 'haversine') then
    raise exception 'invalid_distance_source';
  end if;
  if not exists (select 1 from public.material_prices where material::text = _material) then
    raise exception 'invalid_material';
  end if;
  if _supply_location_id is not null and not exists (
       select 1 from public.material_supply_locations
        where id = _supply_location_id and material::text = _material) then
    raise exception 'invalid_supply_location';
  end if;

  insert into public.price_quotes (customer_id, material, quantity_m3, distance_km, distance_source, supply_location_id)
  values (_customer_id, _material, _quantity_m3, round(_distance_km, 2), _distance_source, _supply_location_id)
  returning id into _id;
  return _id;
end $$;
revoke all on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid) to service_role;

-- Quote lookup / consumption for the budget trigger. The trigger runs as the
-- calling customer, who has no UPDATE policy on price_quotes, so the old
-- trigger's "consume" UPDATE silently matched 0 rows (quotes were reusable).
-- These run as owner but only ever act on the caller's own (or anonymous) quote.
create or replace function public.price_quote_for_job(_quote_id uuid, _customer_id uuid, _material text, _quantity numeric)
returns public.price_quotes
language plpgsql
security definer
set search_path to 'public'
as $$
declare _q public.price_quotes;
begin
  if auth.uid() is not null and auth.uid() is distinct from _customer_id then
    return null;
  end if;
  select * into _q from public.price_quotes
   where id = _quote_id
     and consumed_at is null
     and expires_at > now()
     and material = _material
     and quantity_m3 = _quantity
     and (customer_id is null or customer_id = _customer_id)
   for update;
  return _q;
end $$;
revoke all on function public.price_quote_for_job(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.price_quote_for_job(uuid, uuid, text, numeric) to authenticated, service_role;

create or replace function public.consume_price_quote(_quote_id uuid, _customer_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.price_quotes set consumed_at = now()
   where id = _quote_id and consumed_at is null
     and (customer_id is null or customer_id = _customer_id)
     and (auth.uid() is null or auth.uid() = _customer_id);
$$;
revoke all on function public.consume_price_quote(uuid, uuid) from public, anon;
grant execute on function public.consume_price_quote(uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Budget validation with server-derived pickup (live body + F11 blocks)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_validate_job_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  _mp public.material_prices;
  _haversine_km numeric;
  _distance_km numeric;
  _quote public.price_quotes;
  _offer jsonb;
  _min numeric;
  _max numeric;
  _loc public.material_supply_locations;
  _client_insert boolean := tg_op = 'INSERT' and current_user in ('authenticated', 'anon');
  _quote_ok boolean := false;
begin
  -- F11: reject impossible / non-Zimbabwe coordinates first, with a clear
  -- message (this trigger runs before jobs_guard_insert, which repeats it).
  if _client_insert then
    if (new.delivery_lat is not null or new.delivery_lng is not null)
       and not (new.delivery_lat between -23.0 and -15.0 and new.delivery_lng between 25.0 and 33.5) then
      raise exception 'The delivery location must be in Zimbabwe.' using errcode = '22023';
    end if;
  end if;

  select * into _mp from public.material_prices where material = new.material;
  if _mp is null or not _mp.enforced then
    if _client_insert then
      -- Unpriced (custom) material: nothing server-computed to keep.
      new.pricing_breakdown := null;
      new.pricing_version := null;
    end if;
    return new;
  end if;
  if new.budget is null then return new; end if;

  new.supply_location_id := null;

  if new.quote_id is not null then
    _quote := public.price_quote_for_job(new.quote_id, new.customer_id, new.material::text, new.quantity_m3);
    _quote_ok := _quote.id is not null;
  end if;

  if _client_insert then
    -- F11: priced jobs are created against a server quote and real delivery
    -- coordinates; the pickup point is never taken from the client.
    if not _quote_ok then
      raise exception 'Your price quote is missing or has expired — please get a new quote.'
        using errcode = '22023';
    end if;
    if new.delivery_lat is null or new.delivery_lng is null then
      raise exception 'Choose the delivery location on the map to get a price.' using errcode = '22023';
    end if;
    if _quote.supply_location_id is not null then
      select * into _loc from public.material_supply_locations where id = _quote.supply_location_id;
    end if;
    if _loc.id is not null and _loc.lat is not null and _loc.lng is not null then
      new.pickup_lat := _loc.lat;
      new.pickup_lng := _loc.lng;
    elsif _mp.pickup_lat is not null and _mp.pickup_lng is not null then
      new.pickup_lat := _mp.pickup_lat;
      new.pickup_lng := _mp.pickup_lng;
    else
      new.pickup_lat := -17.8292;   -- Harare: the app's default pickup point
      new.pickup_lng := 31.0522;
    end if;
  end if;

  if new.pickup_lat is not null and new.pickup_lng is not null
     and new.delivery_lat is not null and new.delivery_lng is not null then
    _haversine_km := 2 * 6371 * asin(sqrt(
      power(sin(radians(new.delivery_lat - new.pickup_lat) / 2), 2) +
      cos(radians(new.pickup_lat)) * cos(radians(new.delivery_lat)) *
      power(sin(radians(new.delivery_lng - new.pickup_lng) / 2), 2)
    ));
  else
    _haversine_km := 15;
  end if;

  _distance_km := _haversine_km;

  if _quote_ok then
    if _quote.distance_km >= _haversine_km * 0.95
       and _quote.distance_km <= greatest(_haversine_km * 3, _haversine_km + 30) then
      _distance_km := _quote.distance_km;
      new.supply_location_id := _quote.supply_location_id;
      perform public.consume_price_quote(_quote.id, new.customer_id);
    elsif _client_insert then
      raise exception 'The delivery location changed after your quote — please get a new quote.'
        using errcode = '22023';
    end if;
  end if;

  _offer := public.compute_material_offer(new.material, new.quantity_m3, _distance_km);

  if (_offer->>'enforced')::boolean is not true then return new; end if;
  if _offer->>'min' is null or _offer->>'max' is null then return new; end if;

  _min := (_offer->>'min')::numeric;
  _max := (_offer->>'max')::numeric;

  if new.budget < _min or new.budget > _max then
    raise exception 'Budget $% is outside the allowed range for % ($%-$% for % m³ at ~%km)',
      new.budget, _mp.label, _min, _max, new.quantity_m3, round(_distance_km);
  end if;

  new.pricing_version := _offer->>'pricingVersion';
  new.pricing_breakdown := jsonb_build_object(
    'quantity_m3', new.quantity_m3,
    'distance_km', round(_distance_km, 1),
    'distance_source', case when _distance_km = _haversine_km then 'haversine' else coalesce(_quote.distance_source, 'osrm') end,
    'trip_count', coalesce((_offer->>'tripCount')::int, 1),
    'reference_capacity_m3', coalesce((_offer->>'referenceCapacityM3')::numeric, 10),
    'material_component', (_offer->>'materialCost')::numeric,
    'transport_component', (_offer->>'transportCost')::numeric,
    'low', _min,
    'recommended', (_offer->>'offer')::numeric,
    'high', _max,
    'data_source', coalesce(_offer->>'dataSource', _offer->>'mode', _offer->>'bucketM3'::text, 'bucket')
  );

  return new;
end $function$;

-- -----------------------------------------------------------------------------
-- 3. Insert guard: coordinate sanity + preferred driver (live body + F11)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jobs_guard_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if auth.uid() is null or new.customer_id <> auth.uid() then
    raise exception 'Not authorised to create this job.' using errcode = '42501';
  end if;
  new.status := 'open'; new.driver_id := null; new.accepted_bid_id := null; new.final_price := null;
  new.commission := null; new.held_commission := null; new.completed_at := null; new.cancelled_at := null;
  new.cancelled_by := null; new.cancellation_stage := null; new.cancellation_reason := null; new.delivery_pin := null;
  new.pickup_photo_url := null; new.delivery_photo_url := null; new.pickup_photo_taken_at := null;
  new.delivery_photo_taken_at := null; new.delivered_quantity_m3 := null; new.receiver_name := null;
  new.driver_arrived_pickup_at := null; new.driver_arrived_dropoff_at := null; new.created_at := now();
  new.tracking_token := gen_random_uuid();

  -- F11: Con Z operates in Zimbabwe; reject impossible / non-finite coordinates.
  if new.delivery_lat is not null or new.delivery_lng is not null then
    if not (new.delivery_lat between -23.0 and -15.0 and new.delivery_lng between 25.0 and 33.5) then
      raise exception 'The delivery location must be in Zimbabwe.' using errcode = '22023';
    end if;
  end if;
  if new.pickup_lat is not null or new.pickup_lng is not null then
    if not (new.pickup_lat between -23.0 and -15.0 and new.pickup_lng between 25.0 and 33.5) then
      raise exception 'The pickup location must be in Zimbabwe.' using errcode = '22023';
    end if;
  end if;

  -- F11: a preferred driver must be a real, verified driver (and not yourself).
  if new.preferred_driver_id is not null
     and (new.preferred_driver_id = new.customer_id or not public.is_verified_driver(new.preferred_driver_id)) then
    new.preferred_driver_id := null;
  end if;
  return new;
end $function$;
