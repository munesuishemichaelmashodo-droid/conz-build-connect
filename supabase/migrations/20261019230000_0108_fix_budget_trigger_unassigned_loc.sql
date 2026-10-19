-- 0108_fix_budget_trigger_unassigned_loc  (PREPARED, NOT APPLIED)
--
-- DEFECT (19/10/2026, tester screenshot): "Raise your offer" fails with
--   record "_loc" is not assigned yet
-- raise_job_budget() UPDATEs jobs.budget, which fires tg_validate_job_budget.
-- Since 0090 the radius gate reads _loc.service_radius_km in the same boolean
-- expression as _client_insert:
--     if _client_insert and _haversine_km > _loc.service_radius_km and ...
-- PL/pgSQL does not guarantee short-circuit evaluation, and _loc is only
-- assigned on the client-INSERT path, so on any UPDATE the planner evaluates
-- _loc.service_radius_km on an unassigned record and raises.
--
-- FIX: the body below is the 0090 definition verbatim except for ONE marked
-- block: the _loc read is nested inside `if _client_insert then`, so it can
-- only run on the path that assigned it. Behaviour for client inserts is
-- unchanged (same gate, same message).
--
-- Depends on: 0090 (base body and sourcing_quote_authorizes_booking).

create or replace function public.tg_validate_job_budget()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
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
  if _client_insert then
    if (new.delivery_lat is not null or new.delivery_lng is not null)
       and not (new.delivery_lat between -23.0 and -15.0 and new.delivery_lng between 25.0 and 33.5) then
      raise exception 'The delivery location must be in Zimbabwe.' using errcode = '22023';
    end if;
  end if;

  select * into _mp from public.material_prices where material = new.material;
  if _mp is null or not _mp.enforced then
    if _client_insert then
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

  -- 0108 FIX (only change vs 0090): _loc is assigned only when _client_insert,
  -- so it must be read only inside that branch (no reliance on short-circuit).
  if _client_insert then
    if _haversine_km > _loc.service_radius_km
       and not public.sourcing_quote_authorizes_booking(
             _quote.id, new.customer_id, _quote.supply_location_id, new.delivery_lat, new.delivery_lng)
    then
      raise exception 'The selected supplier no longer serves this delivery location — please get a new quote.'
        using errcode = '22023';
    end if;
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
