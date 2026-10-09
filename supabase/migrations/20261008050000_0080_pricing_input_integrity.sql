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
--      customer/material/quantity, verified in-stock supply location, and
--      delivery coordinates; the pickup point is set only from that source.
--      There is no material-pickup or Harare fallback. A quote whose source
--      is no longer eligible or whose route no longer fits is rejected.
--   3. jobs_guard_insert: coordinates must lie inside Zimbabwe (generous box;
--      all 74 live jobs checked inside); preferred_driver_id kept only if it is
--      a verified driver.
--
-- DEPLOY ORDER: ship the compatible app first, then apply this migration.
-- The app fails closed during the gap because create_price_quote_for is not
-- present yet, so schedule both steps together and do not reopen bookings
-- until the RPC and an eligible verified in-stock source are confirmed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quotes are server-created only
-- -----------------------------------------------------------------------------
-- Replace the earlier permissive supply resolver in the same deployment:
-- automatic pricing requires exact site coordinates, supplier and location
-- verification, a tracked quantity large enough for this job, and a service
-- radius covering the customer's actual delivery pin. NULL stock is unknown,
-- so it cannot be treated as unlimited.
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
    and s.verification_status = 'verified'
    and msl.location_precision = 'exact'
    and msl.lat is not null
    and msl.lng is not null
    and msl.available_quantity_m3 >= _quantity_m3
    and msl.service_radius_km > 0
    and (2 * 6371 * asin(sqrt(
          power(sin(radians(_delivery_lat - msl.lat) / 2), 2) +
          cos(radians(msl.lat)) * cos(radians(_delivery_lat)) *
          power(sin(radians(_delivery_lng - msl.lng) / 2), 2)
        ))) <= msl.service_radius_km
  order by haversine_km asc
  limit 5;
$$;

comment on function public.resolve_material_source_candidates is
  'Pricing candidates must have exact verified supplier-site coordinates, tracked stock sufficient for the order, and an explicit service radius containing the actual customer delivery pin. The server then ranks these candidates by road distance.';

drop function if exists public.create_price_quote(text, numeric, numeric, text);
revoke execute on function public.create_price_quote(text, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.create_price_quote(text, numeric, numeric, text, uuid) to service_role;

create or replace function public.create_price_quote_for(
  _customer_id uuid, _material text, _quantity_m3 numeric, _distance_km numeric,
  _distance_source text, _supply_location_id uuid
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
  if _supply_location_id is null or not exists (
       select 1 from public.material_supply_locations
        where id = _supply_location_id
          and material::text = _material
          and status = 'active'
          and verification_status = 'verified'
          and lat is not null and lng is not null
          and available_quantity_m3 >= _quantity_m3
          and service_radius_km > 0
          and location_precision = 'exact'
          and exists (select 1 from public.suppliers s
                       where s.id = material_supply_locations.supplier_id
                         and s.verification_status = 'verified')) then
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

-- Return only the pickup fields needed by the job trigger. Customers cannot
-- read material_supply_locations directly, so keep this lookup behind a
-- narrowly scoped definer function bound to their own live quote.
create or replace function public.verified_quote_supply_for_job(
  _quote_id uuid, _customer_id uuid, _material text, _quantity numeric
)
returns table (lat numeric, lng numeric, service_radius_km numeric)
language sql
stable
security definer
set search_path to 'public'
as $$
  select msl.lat, msl.lng, msl.service_radius_km
    from public.price_quotes q
    join public.material_supply_locations msl on msl.id = q.supply_location_id
    join public.suppliers s on s.id = msl.supplier_id
   where q.id = _quote_id
     and (q.customer_id is null or q.customer_id = _customer_id)
     and q.material::text = _material
     and q.quantity_m3 = _quantity
     and q.consumed_at is null
     and q.expires_at > now()
     and (auth.uid() is null or auth.uid() = _customer_id)
     and msl.material::text = _material
     and msl.status = 'active'
     and msl.verification_status = 'verified'
     and s.verification_status = 'verified'
     and msl.lat is not null and msl.lng is not null
     and msl.available_quantity_m3 >= _quantity
     and msl.service_radius_km > 0
     and msl.location_precision = 'exact';
$$;
revoke all on function public.verified_quote_supply_for_job(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.verified_quote_supply_for_job(uuid, uuid, text, numeric) to authenticated, service_role;

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
  _loc record;
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
    select * into _loc
      from public.verified_quote_supply_for_job(
        _quote.id, new.customer_id, new.material::text, new.quantity_m3
      );
    if not found then
      raise exception 'The selected supplier is no longer verified or has insufficient stock — please get a new quote.'
        using errcode = '22023';
    end if;
    new.pickup_lat := _loc.lat;
    new.pickup_lng := _loc.lng;
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

  if _client_insert and _haversine_km > _loc.service_radius_km then
    raise exception 'The selected supplier no longer serves this delivery location — please get a new quote.'
      using errcode = '22023';
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
