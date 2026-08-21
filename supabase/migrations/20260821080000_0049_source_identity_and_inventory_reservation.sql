-- 0049: protect source identity through the quote/job chain, and add
-- inventory reservation to accept_bid/cancel_job. Purely additive columns
-- + narrowly-scoped edits to 4 existing functions. Does not touch
-- compute_material_offer, resolveMaterialSource, resolve_material_source_candidates,
-- getRoute, or any pricing rate/threshold.

alter table public.price_quotes
  add column if not exists supply_location_id uuid references public.material_supply_locations(id);

alter table public.jobs
  add column if not exists supply_location_id uuid references public.material_supply_locations(id) on delete restrict;

create index if not exists idx_jobs_supply_location_id on public.jobs(supply_location_id);
create index if not exists idx_price_quotes_supply_location_id on public.price_quotes(supply_location_id);

comment on column public.price_quotes.supply_location_id is
  'The material_supply_locations row resolveMaterialSource selected for this quote, if any. NULL for a legacy-fallback quote (no configured supply locations for that material). Carried onto jobs.supply_location_id by tg_validate_job_budget when this quote is consumed -- never client-supplied.';
comment on column public.jobs.supply_location_id is
  'Which material_supply_locations row this job''s quote actually used, server-derived from the consumed price_quotes row (never client-supplied, never re-resolved). NULL for legacy-fallback jobs, which do not participate in depot inventory reservation. Immutable after job creation. ON DELETE RESTRICT: a supply location that has ever been used by a job cannot be hard-deleted -- pause or close it instead.';

-- 1. create_price_quote: store the resolved source alongside distance.
create or replace function public.create_price_quote(
  _material text,
  _quantity_m3 numeric,
  _distance_km numeric,
  _distance_source text,
  _supply_location_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
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

  insert into public.price_quotes (customer_id, material, quantity_m3, distance_km, distance_source, supply_location_id)
  values (auth.uid(), _material, _quantity_m3, _distance_km, coalesce(_distance_source, 'osrm'), _supply_location_id)
  returning id into _id;

  return _id;
end;
$$;

-- 2. tg_validate_job_budget: carry supply_location_id from the consumed
-- quote onto the job. Everything else in this function is untouched --
-- same distance/budget/pricing logic as before.
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

  _distance_km := _haversine_km;

  -- A client-supplied supply_location_id must never survive untouched.
  -- The only way this column gets set below is from a genuinely matched,
  -- sanity-bound-passing price_quotes row -- reset it first so any value
  -- the client put directly in the INSERT is discarded by default.
  new.supply_location_id := null;

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
      if _quote.distance_km >= _haversine_km * 0.95
         and _quote.distance_km <= greatest(_haversine_km * 3, _haversine_km + 30) then
        _distance_km := _quote.distance_km;
        new.supply_location_id := _quote.supply_location_id;
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

-- 3. accept_bid: add inventory reservation inside the existing guards.
-- Everything before/after the new block is byte-identical to the
-- current live function.
create or replace function public.accept_bid(_bid_id uuid)
returns jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  _bid   public.bids;
  _job   public.jobs;
  _guard jsonb;
  _loc   public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Bid not found'; end if;

  select * into _job from public.jobs where id = _bid.job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.status <> 'open' then raise exception 'Job not open'; end if;
  if _bid.status <> 'pending' then raise exception 'Bid no longer available'; end if;

  -- Inventory reservation: only for jobs with a resolved supply location.
  -- Placed after the guards above (so a retry can never reserve twice --
  -- the bid.status/job.status checks already prevent re-entry) and before
  -- the job/bid state updates below, all inside this same locked
  -- transaction.
  if _job.supply_location_id is not null then
    select * into _loc from public.material_supply_locations
      where id = _job.supply_location_id for update;
    if found and _loc.available_quantity_m3 is not null then
      if _loc.available_quantity_m3 < _job.quantity_m3 then
        raise exception 'This supply location no longer has enough available quantity (needs % m³, has % m³)',
          _job.quantity_m3, _loc.available_quantity_m3;
      end if;
      update public.material_supply_locations
         set available_quantity_m3 = available_quantity_m3 - _job.quantity_m3,
             updated_at = now()
       where id = _loc.id;
    end if;
    -- available_quantity_m3 IS NULL -> untracked, no decrement, no check.
  end if;

  update public.bids set status = 'accepted' where id = _bid_id;
  update public.bids set status = 'rejected'
   where job_id = _job.id and id <> _bid_id and status = 'pending';

  update public.jobs
     set status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.price
   where id = _job.id
  returning * into _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  if (_guard->>'ok')::boolean is not true then
    raise exception 'Driver has insufficient wallet balance: needs $%, has $% available',
      _guard->>'required', _guard->>'available';
  end if;

  perform public.hold_job_commission(_job.id);

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job.id and status = 'pending';

  return _job;
end $function$;

-- 4. cancel_job: add reservation release inside the existing guards.
-- Everything else is byte-identical to the current live function.
create or replace function public.cancel_job(_job_id uuid, _reason text default null::text)
returns jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if not (_is_admin or auth.uid() = _job.customer_id or auth.uid() = _job.driver_id) then
    raise exception 'Not authorised to cancel this job';
  end if;
  if _job.status in ('completed','cancelled') then
    raise exception 'Job already % and cannot be cancelled', _job.status;
  end if;
  if _job.status = 'in_progress' and not _is_admin then
    raise exception 'Job is in progress — raise a dispute instead of cancelling';
  end if;

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  -- Reservation release: only for jobs that had actually reserved
  -- inventory (post-acceptance or later), gated by the SAME _stage the
  -- existing code already computes, and inside the same status guard
  -- above that already prevents this function from running twice on the
  -- same job -- this is what makes the release exactly-once.
  if _stage <> 'pre_acceptance' and _job.supply_location_id is not null then
    select * into _loc from public.material_supply_locations
      where id = _job.supply_location_id for update;
    if found and _loc.available_quantity_m3 is not null then
      update public.material_supply_locations
         set available_quantity_m3 = available_quantity_m3 + _job.quantity_m3,
             updated_at = now()
       where id = _loc.id;
    end if;
  end if;

  perform public.release_job_commission(_job_id);

  update public.jobs
     set status = 'cancelled', cancellation_reason = _reason,
         cancellation_stage = _stage, cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = _job_id
  returning * into _job;

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job_id and status = 'pending';

  if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
    perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);
  end if;

  if _stage <> 'pre_acceptance' and auth.uid() = _job.driver_id then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_job.driver_id, _job_id, 'driver', _stage, _reason);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'));
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'));
  end if;

  return _job;
end $function$;
