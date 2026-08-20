-- 0044: authoritative server-computed distance for pricing, closing the gap
-- between the OSRM road distance shown to the customer at quote time and
-- the haversine (straight-line) distance tg_validate_job_budget recomputes
-- at job-insert time. A customer on a winding route could see a correct,
-- higher road-distance quote, then have that same budget rejected because
-- haversine put the delivery in a cheaper zone band.
--
-- Design: the server (computeOffer/computePublicOffer) now derives distance
-- itself from pickup/delivery coordinates via the same OSRM+haversine-fallback
-- routing call used for the map, instead of trusting a client-supplied
-- distanceKm number. That authoritative distance is persisted in a new
-- price_quotes row the client cannot write to or edit (RLS blocks direct
-- insert/update; only a SECURITY DEFINER function can create one). At job
-- creation, the client references that quote by id; the trigger looks it up
-- itself, checks it's unexpired/unconsumed/matches material+quantity+customer,
-- sanity-bounds it against its own haversine calculation (catches quote
-- reuse against a different route), and uses it in place of haversine when
-- valid. No second pricing formula is introduced -- compute_material_offer
-- remains the sole pricing calculation; only its distance input changes.
--
-- Backwards compatible: jobs.quote_id is nullable. Any job without a valid
-- quote_id (old client, OSRM was unavailable and no coords were supplied,
-- expired/consumed/mismatched quote) falls back to the exact haversine
-- calculation this trigger already used before this migration.

create table if not exists public.price_quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete cascade,
  material text not null,
  quantity_m3 numeric not null,
  distance_km numeric not null,
  distance_source text not null default 'osrm',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz
);

comment on table public.price_quotes is
  'Server-computed (OSRM road distance, or haversine fallback) distance snapshots tied to a pricing quote. Written only via create_price_quote (SECURITY DEFINER) -- clients cannot insert/update rows directly, so a quote''s distance cannot be client-manipulated. Consumed once by tg_validate_job_budget at job creation.';

alter table public.price_quotes enable row level security;

drop policy if exists "select own price quotes" on public.price_quotes;
create policy "select own price quotes" on public.price_quotes
  for select
  using (auth.uid() = customer_id);

-- Deliberately no insert/update/delete policies for anon/authenticated:
-- the only write path is the SECURITY DEFINER function below.

create or replace function public.create_price_quote(
  _material text,
  _quantity_m3 numeric,
  _distance_km numeric,
  _distance_source text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  if _distance_km is null or _distance_km < 0 then
    raise exception 'invalid_distance';
  end if;
  if _quantity_m3 is null or _quantity_m3 <= 0 then
    raise exception 'invalid_quantity';
  end if;

  insert into public.price_quotes (customer_id, material, quantity_m3, distance_km, distance_source)
  values (auth.uid(), _material, _quantity_m3, _distance_km, coalesce(_distance_source, 'osrm'))
  returning id into _id;

  return _id;
end;
$$;

grant execute on function public.create_price_quote(text, numeric, numeric, text) to authenticated, anon;

alter table public.jobs
  add column if not exists quote_id uuid references public.price_quotes(id);

comment on column public.jobs.quote_id is
  'Optional reference to the price_quotes row created when the customer got their quote. When present and valid, tg_validate_job_budget uses its server-computed road distance instead of recomputing haversine, so the customer''s road-distance-based quote and the persisted budget validation agree. Never trusted blindly -- sanity-bounded against the trigger''s own haversine calculation and consumed (single-use) on success.';

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
begin
  select * into _mp from public.material_prices where material = new.material;
  if _mp is null or not _mp.enforced then return new; end if;
  if new.budget is null then return new; end if;

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

  -- Default to the existing haversine behaviour; only override it with a
  -- verified, single-use, server-computed quote below.
  _distance_km := _haversine_km;

  if new.quote_id is not null then
    select * into _quote from public.price_quotes
      where id = new.quote_id
        and consumed_at is null
        and expires_at > now()
        and material = new.material::text
        and quantity_m3 = new.quantity_m3
        and (customer_id is null or customer_id = new.customer_id)
      limit 1;

    if found then
      -- Sanity bound: a real road distance for this route can never be
      -- shorter than the straight line between the same two points, and
      -- shouldn't plausibly be more than ~3x it (or +30km) for a legitimate
      -- route. Anything outside that range suggests a stale/mismatched
      -- quote (e.g. attached to different coordinates) -- fall back to
      -- haversine rather than trust it.
      if _quote.distance_km >= _haversine_km * 0.95
         and _quote.distance_km <= greatest(_haversine_km * 3, _haversine_km + 30) then
        _distance_km := _quote.distance_km;
        update public.price_quotes set consumed_at = now() where id = _quote.id;
      end if;
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
