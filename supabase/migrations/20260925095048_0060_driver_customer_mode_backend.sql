-- 0060: backend for the driver / customer mode redesign.
--
-- Small, additive pieces the redesigned screens were missing. Nothing here
-- changes pricing, commission, escrow, wallets or existing RPCs; every new
-- function is SECURITY DEFINER with an explicit caller check, and every
-- new column is nullable (existing rows and inserts are unaffected).
--
--   1. bids.eta_minutes           — "I can reach pickup in 15 / 30 / 60 min"
--   2. withdraw_bid(bid)          — driver withdraws their own pending bid
--   3. job_offer_summary(job)     — count + price range of OTHER offers,
--                                   only for a driver who has bid on it
--   4. jobs.driver_arrived_*_at   — "I've arrived at pickup / drop-off",
--      + driver_mark_arrived()      server-stamped so the customer's step
--      + client-write guard         bar matches the driver's exactly
--   5. driver_today_earnings()    — "Today $X · N jobs" on the driver home
--   6. customer_cards(job_ids)    — customer first name + rating on the
--                                   driver job feed (no phone/surname)
--
-- The price-range hint needs no change: jobs.pricing_breakdown already
-- holds the server-computed low / recommended / high from
-- tg_validate_job_budget.
--
-- Safe to replay: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.

-- 1. Driver ETA on a bid -----------------------------------------------------
alter table public.bids add column if not exists eta_minutes integer;
do $$ begin
  alter table public.bids
    add constraint bids_eta_minutes_range check (eta_minutes is null or eta_minutes between 5 and 1440);
exception when duplicate_object then null;
end $$;

-- 2. Withdraw a bid ----------------------------------------------------------
-- bids_guard_direct_write deliberately blocks drivers changing a bid's
-- status from the client, and there is no DELETE policy on bids. A pending
-- bid on a still-open job is removed outright (nothing references bids by
-- foreign key), so the driver can bid again later through the normal
-- insert path — marking it 'withdrawn' would permanently block re-bidding,
-- because the guard refuses edits to non-pending bids.
create or replace function public.withdraw_bid(_bid_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _bid public.bids;
  _job public.jobs;
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if _bid.driver_id <> auth.uid() then
    raise exception 'You can only withdraw your own offer.' using errcode = '42501';
  end if;
  if _bid.status <> 'pending' then
    raise exception 'This offer has already been decided and can no longer be withdrawn.';
  end if;

  select * into _job from public.jobs where id = _bid.job_id for share;
  if not found or _job.status <> 'open' then
    raise exception 'This job is no longer open.';
  end if;

  delete from public.bids where id = _bid_id;
end $$;

revoke execute on function public.withdraw_bid(uuid) from public, anon;
grant execute on function public.withdraw_bid(uuid) to authenticated;

-- 3. Other offers on a job (summary only) ------------------------------------
-- Drivers still cannot read other drivers' bids (RLS unchanged). This
-- returns only a count and min/max of the OTHER pending offers, and only
-- to a driver who has an offer on that open job themselves.
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
   where job_id = _job_id and status = 'pending' and driver_id <> auth.uid();

  return jsonb_build_object('others', _count, 'min', _min, 'max', _max);
end $$;

revoke execute on function public.job_offer_summary(uuid) from public, anon;
grant execute on function public.job_offer_summary(uuid) to authenticated;

-- 4. Arrival timestamps ------------------------------------------------------
alter table public.jobs add column if not exists driver_arrived_pickup_at timestamptz;
alter table public.jobs add column if not exists driver_arrived_dropoff_at timestamptz;

-- Only driver_mark_arrived() may set these (it runs as the function owner,
-- so current_user is not a client role there). Kept as its own small
-- trigger so jobs_guard_direct_write stays exactly as it is.
create or replace function public.jobs_guard_arrival_fields()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.driver_arrived_pickup_at is distinct from old.driver_arrived_pickup_at
          or new.driver_arrived_dropoff_at is distinct from old.driver_arrived_dropoff_at)
  then
    raise exception 'Arrival times can only be recorded through the app.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists jobs_guard_arrival_fields on public.jobs;
create trigger jobs_guard_arrival_fields
  before update on public.jobs
  for each row execute function public.jobs_guard_arrival_fields();

-- _stage: 'pickup' | 'dropoff'. _arrived = false undoes a mistaken tap, but
-- only until the next evidence photo for that stage exists.
create or replace function public.driver_mark_arrived(_job_id uuid, _stage text, _arrived boolean default true)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job public.jobs;
  _at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if _stage not in ('pickup', 'dropoff') then
    raise exception 'Unknown stage %', _stage;
  end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.driver_id is distinct from auth.uid() then
    raise exception 'Only the assigned driver can do this.' using errcode = '42501';
  end if;
  if _job.status not in ('accepted', 'in_progress') then
    raise exception 'This job is not active.';
  end if;

  if _stage = 'pickup' then
    if _job.pickup_photo_url is not null then
      return _job.driver_arrived_pickup_at;  -- trip already started; nothing to change
    end if;
    _at := case when _arrived then coalesce(_job.driver_arrived_pickup_at, now()) else null end;
    update public.jobs set driver_arrived_pickup_at = _at where id = _job_id;
  else
    if _job.pickup_photo_url is null then
      raise exception 'Take the loaded-truck photo at pickup first.';
    end if;
    if _job.delivery_photo_url is not null then
      return _job.driver_arrived_dropoff_at;
    end if;
    _at := case when _arrived then coalesce(_job.driver_arrived_dropoff_at, now()) else null end;
    update public.jobs set driver_arrived_dropoff_at = _at where id = _job_id;
  end if;

  return _at;
end $$;

revoke execute on function public.driver_mark_arrived(uuid, text, boolean) from public, anon;
grant execute on function public.driver_mark_arrived(uuid, text, boolean) to authenticated;

-- 5. Today's earnings --------------------------------------------------------
-- "Today" in Zimbabwe time. Earned = job price minus the commission the
-- completion functions actually recorded on the job.
create or replace function public.driver_today_earnings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'earned', coalesce(sum(coalesce(final_price, budget) - coalesce(commission, 0)), 0),
    'jobs', count(*)
  ) end
  from public.jobs
  where driver_id = auth.uid()
    and status = 'completed'
    and completed_at >= (date_trunc('day', now() at time zone 'Africa/Harare') at time zone 'Africa/Harare');
$$;

revoke execute on function public.driver_today_earnings() from public, anon;
grant execute on function public.driver_today_earnings() to authenticated;

-- 6. Customer card on the driver feed ----------------------------------------
-- First name + customer rating only (no surname, phone, or anything else).
-- Caller must be a driver, and only for jobs that are open or that the
-- caller is already on (assigned, or has bid) — so it can't be used to
-- enumerate customers. Capped at 100 jobs per call.
create or replace function public.customer_cards(_job_ids uuid[])
returns table (job_id uuid, first_name text, rating_avg numeric, rating_count integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'driver'::public.app_role) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if coalesce(array_length(_job_ids, 1), 0) > 100 then
    raise exception 'Too many jobs requested.';
  end if;

  return query
    select j.id,
           nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 1), ''),
           p.customer_rating_avg::numeric,
           p.customer_rating_count::integer
      from public.jobs j
      join public.profiles p on p.id = j.customer_id
     where j.id = any(_job_ids)
       and (j.status = 'open'
            or j.driver_id = auth.uid()
            or exists (select 1 from public.bids b where b.job_id = j.id and b.driver_id = auth.uid()));
end $$;

revoke execute on function public.customer_cards(uuid[]) from public, anon;
grant execute on function public.customer_cards(uuid[]) to authenticated;
