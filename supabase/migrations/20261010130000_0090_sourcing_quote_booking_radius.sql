-- 0090_sourcing_quote_booking_radius  (PREPARED, NOT APPLIED)
--
-- DEFECT (found by reading the real booking trigger, 11/10/2026): a customer
-- booking an admin-issued sourcing quote hits tg_validate_job_budget's
-- "supplier no longer serves this delivery location" gate, because sourcing
-- exists precisely for deliveries outside every automatic supplier's
-- service_radius_km. pgTAP 140 did not see it because its conversion insert
-- runs as the table owner, and the gate only applies to client inserts
-- (current_user in authenticated/anon). Customers could never convert.
--
-- FIX: the body below is the 0080 definition verbatim except for ONE marked
-- block: the radius gate is skipped when (and only when) the quote is bound to
-- the customer's own quote_ready, unexpired sourcing request at the same supply
-- location and the delivery pin is within 1 km of the pinned one. All other
-- checks (verified supplier, stock, exact coordinates, quote ownership,
-- quantity, distance tolerance, price range, single-use consumption) still run.
--
-- Depends on: 0080 (this function's base body), 0087/0088 (sourcing columns).
-- Apply after 0088.

-- The booking trigger runs as the customer, who has no direct access to the
-- sourcing table (0088), so the authorisation lookup is a narrow definer
-- function bound to the caller's own identity.
create or replace function public.sourcing_quote_authorizes_booking(
  _quote_id uuid, _customer_id uuid, _supply_location_id uuid,
  _delivery_lat double precision, _delivery_lng double precision)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.material_sourcing_requests r
     where r.quote_id = _quote_id
       and r.customer_id = _customer_id
       and (auth.uid() is null or auth.uid() = _customer_id)
       and r.status = 'quote_ready'
       and r.quote_valid_until > now()
       and r.supply_location_id = _supply_location_id
       and r.delivery_lat is not null and r.delivery_lng is not null
       and _delivery_lat is not null and _delivery_lng is not null
       and 2 * 6371 * asin(least(1, sqrt(
             power(sin(radians(_delivery_lat - r.delivery_lat) / 2), 2) +
             cos(radians(r.delivery_lat)) * cos(radians(_delivery_lat)) *
             power(sin(radians(_delivery_lng - r.delivery_lng) / 2), 2)))) <= 1.0)
$$;
revoke all on function public.sourcing_quote_authorizes_booking(uuid, uuid, uuid, double precision, double precision) from public, anon;
grant execute on function public.sourcing_quote_authorizes_booking(uuid, uuid, uuid, double precision, double precision) to authenticated, service_role;

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

  -- 0090: a quote that an admin issued through the sourcing workflow
  -- (issue_sourcing_quote -> material_sourcing_requests.quote_id) is, by
  -- definition, for a delivery OUTSIDE every automatic supplier's service
  -- radius. The admin validated that supplier for this exact request, so the
  -- radius gate must not reject it -- but only for the customer who owns the
  -- live request, only while it is quote_ready and unexpired, only from the
  -- quoted supply location, and only for a delivery pin within 1 km of the one
  -- the quote was priced for. Everything else is unchanged.
  if _client_insert and _haversine_km > _loc.service_radius_km
     and not public.sourcing_quote_authorizes_booking(
           _quote.id, new.customer_id, _quote.supply_location_id, new.delivery_lat, new.delivery_lng)
  then
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
