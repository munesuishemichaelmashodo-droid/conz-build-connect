-- 0062: offer expiry, "raise my price", approximate truck positions.
--
-- Owner asked (25/09/2026) for the inDrive/Uber-style behaviour:
--
--   1. Driver offers are valid for 30 minutes. Server-stamped on every
--      insert and every driver edit/resend, restarted when the customer
--      sends a counter-offer. An expired offer can't be accepted — enforced
--      by a BEFORE UPDATE trigger on bids, so accept_bid / accept_counter
--      themselves are untouched (the whole accept transaction, commission
--      hold included, rolls back). The driver resends to restart the clock.
--   2. raise_job_budget(): the customer can only RAISE an open job's offer,
--      capped at the job's stored allowed maximum (pricing_breakdown.high).
--      tg_validate_job_budget still re-validates the new budget; its
--      side-effects on UPDATE (clearing supply_location_id, rewriting
--      pricing_breakdown from a haversine re-quote) are undone right after,
--      so the original quote's source and range are kept.
--   3. Approximate truck positions, only for drivers who switched
--      themselves Online (driver_availability, fresh in the last 15 min):
--      nearby_available_trucks() for the booking map (positions rounded to
--      ~1 km, no ids, verified drivers only) and job_bidder_locations() so
--      a customer sees roughly where each driver who bid on their open job
--      is and how far they are from pickup.
--
-- Additive; all new functions SECURITY DEFINER with caller checks, anon
-- revoked. Safe to replay.

-- 1. Offer expiry -----------------------------------------------------------
alter table public.bids add column if not exists expires_at timestamptz;

create or replace function public.tg_bids_offer_expiry()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  _validity constant interval := interval '30 minutes';
begin
  if tg_op = 'INSERT' then
    new.expires_at := now() + _validity;
    return new;
  end if;

  -- Accepting (accept_bid / accept_counter) an offer whose clock ran out.
  if new.status = 'accepted' and old.status = 'pending'
     and old.expires_at is not null and old.expires_at < now() then
    raise exception 'This offer has expired. Ask the driver to send it again.'
      using errcode = '42501';
  end if;

  if current_user in ('authenticated', 'anon') then
    -- Clients can never set the expiry themselves. A driver editing or
    -- resending their own pending offer restarts the clock.
    if old.driver_id = auth.uid() and old.status = 'pending' and new.status = 'pending' then
      new.expires_at := now() + _validity;
    else
      new.expires_at := old.expires_at;
    end if;
  elsif new.counter_status = 'countered' and old.counter_status is distinct from 'countered' then
    -- Customer counter-offer (counter_bid): the driver gets a fresh window.
    new.expires_at := now() + _validity;
  end if;

  return new;
end $$;

drop trigger if exists trg_bids_offer_expiry on public.bids;
create trigger trg_bids_offer_expiry
  before insert or update on public.bids
  for each row execute function public.tg_bids_offer_expiry();

-- Existing pending offers get a full window from now rather than
-- expiring instantly.
update public.bids set expires_at = now() + interval '30 minutes'
 where status = 'pending' and expires_at is null;

-- job_offer_summary (0060): count / range only live offers.
create or replace function public.job_offer_summary(_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _count int;
  _min numeric;
  _max numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.bids b join public.jobs j on j.id = b.job_id
     where b.job_id = _job_id and b.driver_id = auth.uid() and j.status = 'open'
  ) then
    return null;
  end if;

  select count(*), min(price), max(price) into _count, _min, _max
    from public.bids
   where job_id = _job_id and status = 'pending' and driver_id <> auth.uid()
     and (expires_at is null or expires_at > now());

  return jsonb_build_object('others', _count, 'min', _min, 'max', _max);
end $$;

-- 2. Raise my price ----------------------------------------------------------
create or replace function public.raise_job_budget(_job_id uuid, _new_budget numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job public.jobs;
  _cap numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can change this offer.' using errcode = '42501';
  end if;
  if _job.status <> 'open' then
    raise exception 'Drivers can only see price changes while the job is open.';
  end if;
  if _new_budget is null or _new_budget <= _job.budget then
    raise exception 'You can only raise your offer.';
  end if;

  _cap := nullif(_job.pricing_breakdown->>'high', '')::numeric;
  if _cap is not null and _new_budget > _cap then
    raise exception 'The most you can offer for this trip is $%.', _cap;
  end if;

  -- tg_validate_job_budget re-checks the new budget against the pricing
  -- engine (and raises if it's out of range).
  update public.jobs set budget = round(_new_budget, 2) where id = _job_id;

  -- Undo that trigger's UPDATE-time side effects so the job keeps the
  -- supply source and price range from its original quote. (This UPDATE
  -- doesn't touch budget/material, so the trigger doesn't fire again.)
  update public.jobs
     set supply_location_id = _job.supply_location_id,
         pricing_breakdown  = _job.pricing_breakdown,
         pricing_version    = _job.pricing_version
   where id = _job_id;

  return round(_new_budget, 2);
end $$;

revoke execute on function public.raise_job_budget(uuid, numeric) from public, anon;
grant execute on function public.raise_job_budget(uuid, numeric) to authenticated;

-- 3. Approximate truck positions --------------------------------------------
-- ~1 km grid (2 decimal places). Nothing that identifies a driver.
create or replace function public.nearby_available_trucks(_lat numeric, _lng numeric)
returns table (lat numeric, lng numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if _lat is null or _lng is null then return; end if;

  return query
    select distinct round(a.lat, 2), round(a.lng, 2)
      from public.driver_availability a
      join public.driver_profiles dp on dp.user_id = a.driver_id
     where a.is_available
       and a.lat is not null and a.lng is not null
       and a.updated_at > now() - interval '15 minutes'
       and dp.verification_status = 'verified'
       and a.driver_id <> auth.uid()
       and 2 * 6371 * asin(sqrt(
             power(sin(radians(a.lat - _lat) / 2), 2) +
             cos(radians(_lat)) * cos(radians(a.lat)) *
             power(sin(radians(a.lng - _lng) / 2), 2))) <= 40
     limit 20;
end $$;

revoke execute on function public.nearby_available_trucks(numeric, numeric) from public, anon;
grant execute on function public.nearby_available_trucks(numeric, numeric) to authenticated;

-- For the customer of an open job: rough position of each driver who bid
-- (only if that driver is Online now) and their distance to pickup.
create or replace function public.job_bidder_locations(_job_id uuid)
returns table (bid_id uuid, lat numeric, lng numeric, km_to_pickup numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _job public.jobs;
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into _job from public.jobs where id = _job_id;
  if not found or _job.customer_id <> auth.uid() or _job.status <> 'open' then
    return;
  end if;

  return query
    select b.id,
           round(a.lat, 2),
           round(a.lng, 2),
           case when _job.pickup_lat is null or _job.pickup_lng is null then null
           else round((2 * 6371 * asin(sqrt(
             power(sin(radians(a.lat - _job.pickup_lat) / 2), 2) +
             cos(radians(_job.pickup_lat)) * cos(radians(a.lat)) *
             power(sin(radians(a.lng - _job.pickup_lng) / 2), 2))))::numeric, 0)
           end
      from public.bids b
      join public.driver_availability a on a.driver_id = b.driver_id
     where b.job_id = _job_id
       and b.status = 'pending'
       and a.is_available
       and a.lat is not null and a.lng is not null
       and a.updated_at > now() - interval '15 minutes';
end $$;

revoke execute on function public.job_bidder_locations(uuid) from public, anon;
grant execute on function public.job_bidder_locations(uuid) to authenticated;
