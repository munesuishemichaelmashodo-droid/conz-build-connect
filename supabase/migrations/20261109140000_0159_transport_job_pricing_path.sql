-- 0159: transport-only job pricing path (OFF: refused unless system_settings.transport_pricing_enabled = true).
--
-- The customer gives a real pickup point and a delivery point. The SERVER measures the road distance and records it in a
-- transport quote (service role only, like price_quotes). A job priced 'transport_only' must carry that quote; the database
-- then checks the quote belongs to the customer, is unexpired and unused, matches the coordinates and load, and that the budget
-- sits inside the engine's guide band (compute_transport_offer, uncalibrated) before consuming it once.
-- Existing jobs and the supplier-quote path are untouched: tg_validate_job_budget only gets one early return for transport jobs
-- (the rest of its body is the live 0108 definition verbatim; live prosrc md5 3e2eff1f...).
-- Commission is unchanged (functions read final_price/budget): for these jobs that number is the transport fare.
-- No DROP. Undo: supabase/rollbacks/20261109140000_0159_rollback.sql.

create table if not exists public.transport_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  quantity_m3 numeric not null check (quantity_m3 > 0 and quantity_m3 <= 1000),
  pickup_lat numeric not null, pickup_lng numeric not null,
  delivery_lat numeric not null, delivery_lng numeric not null,
  road_km numeric not null check (road_km > 0 and road_km <= 2000),
  distance_source text not null default 'osrm' check (distance_source = 'osrm'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  check (pickup_lat between -23.0 and -15.0 and pickup_lng between 25.0 and 33.5
     and delivery_lat between -23.0 and -15.0 and delivery_lng between 25.0 and 33.5)
);
alter table public.transport_quotes enable row level security;
revoke all on public.transport_quotes from public, anon, authenticated;
grant select on public.transport_quotes to authenticated;
create policy "Customers read own transport quotes" on public.transport_quotes
  for select to authenticated using (auth.uid() = customer_id);

alter table public.jobs add column if not exists transport_quote_id uuid references public.transport_quotes(id);

-- Server only: the road distance must come from the server's router, never from the browser.
create or replace function public.create_transport_quote_for(
  _customer_id uuid, _quantity_m3 numeric, _pickup_lat numeric, _pickup_lng numeric,
  _delivery_lat numeric, _delivery_lng numeric, _road_km numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare _id uuid;
begin
  insert into public.transport_quotes (customer_id, quantity_m3, pickup_lat, pickup_lng, delivery_lat, delivery_lng, road_km)
  values (_customer_id, _quantity_m3, _pickup_lat, _pickup_lng, _delivery_lat, _delivery_lng, round(_road_km, 2))
  returning id into _id;
  return _id;
end $$;
revoke all on function public.create_transport_quote_for(uuid, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.create_transport_quote_for(uuid, numeric, numeric, numeric, numeric, numeric, numeric) to service_role;

-- Lookup and one-time use for the trigger, bound to the caller's own quote (same pattern as price quotes).
create or replace function public.transport_quote_for_job(_quote_id uuid, _customer_id uuid)
returns public.transport_quotes
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare _q public.transport_quotes;
begin
  if auth.uid() is not null and auth.uid() is distinct from _customer_id then return null; end if;
  select * into _q from public.transport_quotes
   where id = _quote_id and customer_id = _customer_id and consumed_at is null and expires_at > now()
   for update;
  return _q;
end $$;
revoke all on function public.transport_quote_for_job(uuid, uuid) from public, anon;
grant execute on function public.transport_quote_for_job(uuid, uuid) to authenticated, service_role;

create or replace function public.consume_transport_quote(_quote_id uuid, _customer_id uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.transport_quotes set consumed_at = now()
   where id = _quote_id and consumed_at is null and customer_id = _customer_id
     and (auth.uid() is null or auth.uid() = _customer_id);
$$;
revoke all on function public.consume_transport_quote(uuid, uuid) from public, anon;
grant execute on function public.consume_transport_quote(uuid, uuid) to authenticated, service_role;

-- The switch, readable by the (invoking) trigger: customers cannot read system_settings directly.
create or replace function public.transport_pricing_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select (value #>> '{}') = 'true' from public.system_settings where key = 'transport_pricing_enabled'), false)
$$;
revoke all on function public.transport_pricing_enabled() from public, anon;
grant execute on function public.transport_pricing_enabled() to authenticated, service_role;

-- Must see the CALLER's role, so SECURITY INVOKER (same rule as the other guard triggers).
create or replace function public.tg_validate_transport_job()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  _client boolean := current_user in ('authenticated', 'anon');
  _enabled boolean;
  _q public.transport_quotes;
  _offer jsonb;
  _low numeric; _high numeric;
begin
  if tg_op = 'UPDATE' then
    if _client and (new.pricing_basis is distinct from old.pricing_basis
                    or new.transport_quote_id is distinct from old.transport_quote_id) then
      raise exception 'How a job is priced cannot be changed.' using errcode = '42501';
    end if;
    if new.pricing_basis = 'transport_only' and new.budget is distinct from old.budget then
      _low := (new.pricing_breakdown ->> 'low')::numeric;
      _high := (new.pricing_breakdown ->> 'high')::numeric;
      if _low is null or _high is null or new.budget < _low or new.budget > _high then
        raise exception 'Budget $% is outside the guide range ($%-$%) for this delivery.', new.budget, _low, _high
          using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  if new.pricing_basis is distinct from 'transport_only' then
    if new.transport_quote_id is not null then
      raise exception 'A transport quote can only be used on a transport-priced job.' using errcode = '22023';
    end if;
    return new;
  end if;

  _enabled := public.transport_pricing_enabled();
  if not _enabled then
    raise exception 'Transport pricing is not available yet.' using errcode = '22023';
  end if;
  if new.budget is null then
    raise exception 'A price is needed.' using errcode = '22023';
  end if;

  _q := public.transport_quote_for_job(new.transport_quote_id, new.customer_id);
  if _q.id is null then
    raise exception 'Your price quote is missing or has expired. Please get a new quote.' using errcode = '22023';
  end if;
  if new.pickup_lat is null or new.pickup_lng is null or new.delivery_lat is null or new.delivery_lng is null
     or abs(new.pickup_lat - _q.pickup_lat) > 0.00001 or abs(new.pickup_lng - _q.pickup_lng) > 0.00001
     or abs(new.delivery_lat - _q.delivery_lat) > 0.00001 or abs(new.delivery_lng - _q.delivery_lng) > 0.00001
     or new.quantity_m3 is distinct from _q.quantity_m3 then
    raise exception 'The pickup, delivery or load changed after your quote. Please get a new quote.' using errcode = '22023';
  end if;

  _offer := public.compute_transport_offer(_q.road_km, _q.quantity_m3);
  _low := (_offer #>> '{total,low}')::numeric;
  _high := (_offer #>> '{total,high}')::numeric;
  if new.budget < _low or new.budget > _high then
    raise exception 'Budget $% is outside the guide range ($%-$%) for % km by road.', new.budget, _low, _high, _q.road_km
      using errcode = '22023';
  end if;

  perform public.consume_transport_quote(_q.id, new.customer_id);
  new.supply_location_id := null;
  new.pricing_version := 'transport-v2-uncalibrated';
  new.pricing_breakdown := jsonb_build_object(
    'basis', 'transport_only', 'calibration', 'uncalibrated', 'distance_km', _q.road_km,
    'distance_source', _q.distance_source, 'trip_count', (_offer ->> 'trips')::int,
    'low', _low, 'recommended', (_offer #>> '{total,recommended}')::numeric, 'high', _high,
    'pickup_source', 'client');
  return new;
end $$;
revoke all on function public.tg_validate_transport_job() from public, anon, authenticated;

create or replace trigger jobs_validate_transport
  before insert or update on public.jobs
  for each row execute function public.tg_validate_transport_job();

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
  -- 0159: jobs priced by the transport-only engine are validated by tg_validate_transport_job instead.
  if new.pricing_basis = 'transport_only' then return new; end if;
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
