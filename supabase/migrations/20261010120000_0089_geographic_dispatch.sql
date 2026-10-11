-- 0089_geographic_dispatch  (PREPARED, NOT APPLIED)
--
-- DEFECT FIXED. Live create_dispatch_wave() (called by the jobs_initial_dispatch
-- trigger on EVERY new open job, and again by the per-minute sweep) offered a
-- job to the top-rated verified drivers ANYWHERE in Zimbabwe: no location, no
-- truck, no availability, no wallet/suspension check. accept_dispatch_offer()
-- then confirmed the assignment without re-checking any of it.
--
-- NEW BEHAVIOUR (all server-side):
--   * eligible_dispatch_drivers(job, radius): the single definition of "may be
--     offered / may accept this job". A driver must be: a verified driver whose
--     re-verification is not overdue; account active and not restricted; wallet
--     not limited; not the job's customer; not on an active job; opted in as
--     available with a position fresher than 15 min; owner of a registered
--     truck with capacity > 0; and within the radius of the job's PICKUP point.
--   * Pickup point = verified pickup coordinates; if the job has none, the
--     delivery pin (the real job site). A job with neither location is offered
--     to nobody and escalated to the team.
--   * Controlled radius expansion by job age: stages (default 25 -> 50 -> 100
--     km, setting dispatch_radius_stages_km) advance every dispatch_stage_minutes
--     (default 3). The last stage is a hard ceiling: there is never a
--     nationwide broadcast. When the ceiling is reached with nobody eligible,
--     admins get ONE 'dispatch_manual_needed' notification for manual dispatch.
--   * accept_dispatch_offer() re-validates eligibility at acceptance (outer
--     radius) before assigning, under the existing job row lock.
--
-- LIMITS (deliberate, documented):
--   * The driver->pickup screen is great-circle distance (SQL has no road
--     router). It is a lower bound of road distance; pickup->delivery distance
--     for pricing stays on OSRM in the app.
--   * Capacity follows the existing product decision (0045): no trip ceiling,
--     a registered truck with capacity > 0 is eligible and trips are priced,
--     not excluded.
--   * Bidding (bids INSERT policy) and the open-jobs feed are NOT changed here.
--     Drivers can still see/bid on open jobs anywhere; whether to geo-fence
--     the feed is an open product decision (see readiness report).
--
-- Replaces: create_dispatch_wave(uuid, integer), accept_dispatch_offer(uuid)
-- (bodies reproduced from live 11/10/2026 plus the new checks; ACLs unchanged:
-- create_dispatch_wave stays service_role-only, accept_dispatch_offer stays
-- callable by authenticated).

insert into public.system_settings (key, value) values
  ('dispatch_radius_stages_km', '[25, 50, 100]'::jsonb),
  ('dispatch_stage_minutes', '3'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------ configuration
create or replace function public.dispatch_stage_radii()
returns numeric[] language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; r numeric[]; i int; d constant numeric[] := array[25, 50, 100];
begin
  select value into v from public.system_settings where key = 'dispatch_radius_stages_km';
  if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 10 then return d; end if;
  begin
    select array_agg(x::numeric order by ord) into r from jsonb_array_elements_text(v) with ordinality as t(x, ord);
  exception when others then return d;
  end;
  for i in 1..coalesce(array_length(r, 1), 0) loop
    if r[i] is null or r[i] <= 0 or r[i] > 1000 or (i > 1 and r[i] <= r[i - 1]) then return d; end if;
  end loop;
  return coalesce(r, d);
end $$;

create or replace function public.dispatch_stage_minutes()
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare m numeric;
begin
  begin
    select (value::text)::numeric into m from public.system_settings where key = 'dispatch_stage_minutes';
  exception when others then m := null;
  end;
  if m is null or m < 1 or m > 60 then return 3; end if;
  return m;
end $$;

-- Radius for the job's current stage, and whether the final stage is reached.
create or replace function public.dispatch_stage_for(_job_created timestamptz)
returns table (radius_km numeric, final_stage boolean) language plpgsql stable security definer set search_path to 'public' as $$
declare radii numeric[] := public.dispatch_stage_radii(); n int; idx int;
begin
  n := array_length(radii, 1);
  idx := floor(extract(epoch from (now() - _job_created)) / 60.0 / public.dispatch_stage_minutes())::int + 1;
  idx := greatest(1, least(idx, n));
  return query select radii[idx], idx = n;
end $$;

-- ----------------------------------------------- the one eligibility definition
create or replace function public.eligible_dispatch_drivers(_job_id uuid, _radius_km numeric)
returns table (driver_id uuid, pickup_km numeric, capacity_m3 numeric)
language sql stable security definer set search_path to 'public' as $$
  with j as (
    select jb.id, jb.customer_id,
           coalesce(jb.pickup_lat, jb.delivery_lat) as lat,
           coalesce(jb.pickup_lng, jb.delivery_lng) as lng
      from public.jobs jb
     where jb.id = _job_id and jb.status = 'open'
       and coalesce(jb.pickup_lat, jb.delivery_lat) is not null
       and coalesce(jb.pickup_lng, jb.delivery_lng) is not null
  )
  select ur.user_id,
         round(d.km::numeric, 2),
         tr.cap
    from j
    join public.user_roles ur on ur.role = 'driver'
    join public.driver_profiles dp on dp.user_id = ur.user_id
         and dp.verification_status = 'verified'
         and (dp.reverify_due_at is null or dp.reverify_due_at > now())
    join public.profiles p on p.id = ur.user_id
         and p.status = 'active' and p.deleted_at is null
         and (p.restricted_until is null or p.restricted_until <= now())
    join public.wallets w on w.user_id = ur.user_id and w.limited = false
    join public.driver_availability a on a.driver_id = ur.user_id
         and a.is_available and a.lat is not null and a.lng is not null
         and a.updated_at > now() - interval '15 minutes'
    cross join lateral (
      select max(t.capacity_m3) as cap from public.trucks t
       where t.driver_id = ur.user_id and t.capacity_m3 > 0) tr
    cross join lateral (
      select 2 * 6371 * asin(least(1, sqrt(
               power(sin(radians(a.lat - j.lat) / 2), 2) +
               cos(radians(j.lat)) * cos(radians(a.lat)) *
               power(sin(radians(a.lng - j.lng) / 2), 2)))) as km) d
   where tr.cap is not null
     and ur.user_id <> j.customer_id
     and d.km <= _radius_km
     and not exists (select 1 from public.jobs j2
                      where j2.driver_id = ur.user_id and j2.status in ('accepted', 'in_progress'))
   order by d.km asc;
$$;

-- --------------------------------------------------------------- dispatch wave
create or replace function public.create_dispatch_wave(_job_id uuid, _limit integer default 5)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  next_wave integer; created_count integer := 0;
  job_row public.jobs%rowtype; _radius numeric; _final boolean;
begin
  select * into job_row from public.jobs where id = _job_id;
  if not found or job_row.status <> 'open' then return 0; end if;
  if _limit is null or _limit < 1 or _limit > 20 then _limit := 5; end if;

  select s.radius_km, s.final_stage into _radius, _final from public.dispatch_stage_for(job_row.created_at) s;

  select coalesce(max(wave), 0) + 1 into next_wave from public.job_dispatch_offers where job_id = _job_id;

  insert into public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
  select _job_id, e.driver_id, next_wave, now() + interval '10 seconds'
    from public.eligible_dispatch_drivers(_job_id, _radius) e
    join public.driver_profiles dp on dp.user_id = e.driver_id
   where not exists (select 1 from public.job_dispatch_offers o
                      where o.job_id = _job_id and o.driver_id = e.driver_id)
   order by e.pickup_km asc, dp.rating_avg desc nulls last, dp.jobs_completed desc
   limit _limit;
  get diagnostics created_count = row_count;

  -- Nobody eligible even at the ceiling radius (or the job has no location at
  -- all): hand over to the team once, instead of widening further.
  if created_count = 0
     and (coalesce(job_row.pickup_lat, job_row.delivery_lat) is null or (_final and not exists (
           select 1 from public.job_dispatch_offers o where o.job_id = _job_id and o.status = 'pending')))
     and not exists (select 1 from public.notifications n where n.job_id = _job_id and n.type = 'dispatch_manual_needed') then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'dispatch_manual_needed', 'Job needs manual dispatch',
           case when coalesce(job_row.pickup_lat, job_row.delivery_lat) is null
                then 'A job has no pickup or delivery location, so no driver could be matched.'
                else 'No eligible driver is available within ' || _radius::text || ' km of the pickup.' end,
           _job_id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;

  return created_count;
end $$;

-- --------------------------------------------------- re-validate on acceptance
create or replace function public.accept_dispatch_offer(_offer_id uuid)
returns uuid language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  offer_row public.job_dispatch_offers%rowtype;
  job_row   public.jobs%rowtype;
  guard     jsonb;
  _outer    numeric;
begin
  select * into offer_row from public.job_dispatch_offers where id = _offer_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if offer_row.driver_id <> auth.uid() then raise exception 'Not your offer'; end if;
  if offer_row.status <> 'pending' then raise exception 'Offer no longer available'; end if;

  if offer_row.expires_at < now() then
    update public.job_dispatch_offers
       set status = 'expired', responded_at = now() where id = _offer_id;
    raise exception 'Offer expired';
  end if;

  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if job_row.status <> 'open' then raise exception 'Job no longer available'; end if;

  -- 0089: the driver must STILL be eligible for this job (location, truck,
  -- availability, verification, account, wallet, no active job), checked at the
  -- outer radius under the job row lock. The UI is not a security boundary.
  _outer := (select max(r) from unnest(public.dispatch_stage_radii()) r);
  if not exists (select 1 from public.eligible_dispatch_drivers(job_row.id, _outer) e where e.driver_id = auth.uid()) then
    raise exception 'You are not eligible for this job (too far from the pickup, unavailable, or no registered truck).'
      using errcode = '42501';
  end if;

  if not public.is_valid_money(coalesce(job_row.final_price, job_row.budget)) then
    raise exception 'This job has an invalid price and cannot be accepted.';
  end if;

  guard := public.driver_can_accept(job_row.id);
  if (guard->>'ok')::boolean is not true then
    raise exception 'Insufficient wallet balance: need $% commission, have $% available',
      guard->>'required', guard->>'available';
  end if;

  update public.jobs
     set driver_id = auth.uid(), status = 'accepted',
         final_price = coalesce(final_price, budget)
   where id = job_row.id;

  perform public.hold_job_commission(job_row.id);

  update public.bids
     set status = 'rejected'
   where job_id = job_row.id and status = 'pending';

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;
  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = job_row.id and id <> _offer_id and status = 'pending';

  return job_row.id;
end $$;

-- ------------------------------------------------------------------- grants
revoke all on function public.dispatch_stage_radii() from public, anon, authenticated;
revoke all on function public.dispatch_stage_minutes() from public, anon, authenticated;
revoke all on function public.dispatch_stage_for(timestamptz) from public, anon, authenticated;
revoke all on function public.eligible_dispatch_drivers(uuid, numeric) from public, anon, authenticated;
revoke all on function public.create_dispatch_wave(uuid, integer) from public, anon, authenticated;
grant execute on function public.eligible_dispatch_drivers(uuid, numeric) to service_role;
grant execute on function public.create_dispatch_wave(uuid, integer) to service_role;
revoke all on function public.accept_dispatch_offer(uuid) from public, anon;
grant execute on function public.accept_dispatch_offer(uuid) to authenticated, service_role;
