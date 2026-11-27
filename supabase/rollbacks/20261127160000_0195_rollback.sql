-- Undo 0195. Restores the previous invitation, broadcast and next-load definitions exactly (live/0183 bodies).
-- The two new triggers become pass-through (removing them would need DROP); the helpers stay but nothing calls them
-- for invitations any more; the admin explanation is revoked. Withdrawn offers are not restored (drivers re-send).

create or replace function public.tg_bids_driver_eligibility()
returns trigger language plpgsql security definer set search_path to 'public' as $$ begin return new; end $$;
create or replace function public.tg_jobs_withdraw_assigned_driver_offers()
returns trigger language plpgsql security definer set search_path to 'public' as $$ begin return new; end $$;
revoke execute on function public.admin_dispatch_eligibility(uuid) from authenticated;

create or replace function public.eligible_dispatch_drivers(_job_id uuid, _radius_km numeric)
 RETURNS TABLE(driver_id uuid, pickup_km numeric, capacity_m3 numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

create or replace function public.create_dispatch_wave(_job_id uuid, _limit integer DEFAULT 5)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  next_wave integer; created_count integer := 0;
  job_row public.jobs%rowtype; _radius numeric; _final boolean; _mat text;
begin
  select * into job_row from public.jobs where id = _job_id;
  if not found or job_row.status <> 'open' then return 0; end if;
  if _limit is null or _limit < 1 or _limit > 20 then _limit := 5; end if;

  select s.radius_km, s.final_stage into _radius, _final from public.dispatch_stage_for(job_row.created_at) s;

  -- Notification text: load, area, distance and budget only. Never the street address, coordinates or contact
  -- details; the customer's free-text material description is not used because it could contain a phone number.
  _mat := case when job_row.material::text = 'custom' then 'material' else replace(job_row.material::text, '_', ' ') end;
  _mat := upper(left(_mat, 1)) || substr(_mat, 2);

  select coalesce(max(wave), 0) + 1 into next_wave from public.job_dispatch_offers where job_id = _job_id;

  with ins as (
    insert into public.job_dispatch_offers (job_id, driver_id, wave, offered_at, expires_at)
    select _job_id, e.driver_id, next_wave, now(),
           now() + case when a.updated_at > now() - interval '2 minutes'
                        then interval '60 seconds' else interval '5 minutes' end
      from public.eligible_dispatch_drivers(_job_id, _radius) e
      join public.driver_profiles dp on dp.user_id = e.driver_id
      join public.driver_availability a on a.driver_id = e.driver_id
     where not exists (select 1 from public.job_dispatch_offers o
                        where o.job_id = _job_id and o.driver_id = e.driver_id)
     order by e.pickup_km asc, dp.rating_avg desc nulls last, dp.jobs_completed desc
     limit _limit
    returning driver_id, expires_at
  ), note as (
    insert into public.notifications (user_id, type, title, body, job_id)
    select i.driver_id, 'dispatch_offer', 'New delivery near you',
           concat_ws(' ',
             round(job_row.quantity_m3)::text || ' m³ ' || _mat
               || coalesce(' to ' || public.coarse_place(coalesce(job_row.dropoff_address, job_row.delivery_address)), '') || '.',
             case when d.km is not null then 'Pickup about ' || round(d.km)::int::text || ' km from you (straight line).' end,
             case when job_row.budget is not null then 'Budget $' || round(job_row.budget)::text || '.' end,
             'Open ConZ to accept or decline.'),
           _job_id
      from ins i
      left join lateral (select e.pickup_km as km
                           from public.eligible_dispatch_drivers(_job_id, _radius) e
                          where e.driver_id = i.driver_id limit 1) d on true
    returning 1
  )
  select count(*) into created_count from ins;

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
end $function$;

create or replace function public.tg_notify_new_job_posted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'open' then
    insert into public.notifications (user_id, type, title, body, job_id)
    select
      ur.user_id,
      'new_job',
      'New job available',
      coalesce(new.quantity_m3::text || 'm³ ', '') || coalesce(new.material::text, 'Material') ||
        ' delivery to ' || coalesce(public.coarse_place(coalesce(new.dropoff_address, new.delivery_address)), 'a nearby area'),
      new.id
    from public.user_roles ur
    join public.driver_profiles dp on dp.user_id = ur.user_id
    where ur.role = 'driver'
      and dp.verification_status = 'verified'
      and (dp.reverify_due_at is null or dp.reverify_due_at > now());
  end if;
  return new;
end;
$function$;

create or replace function public.find_next_loads_for_driver(_driver_id uuid, _current_job_id uuid)
returns table(job_id uuid, material public.material_category, quantity_m3 numeric, pickup_address text,
              pickup_lat double precision, pickup_lng double precision, delivery_address text,
              delivery_lat double precision, delivery_lng double precision, budget numeric, preferred_date date,
              repositioning_km numeric, next_load_km numeric, empty_km_saved numeric, capacity_tier text,
              capacity_trips integer, recommendation_tier text)
language sql stable security definer set search_path to 'public'
as $$
  select e.job_id, e.material, e.quantity_m3,
         case when j.pricing_basis in ('transport_only', 'transport_request') then public.coarse_place(e.pickup_address) else e.pickup_address end,
         case when j.pricing_basis in ('transport_only', 'transport_request') then public.coarse_coord(e.pickup_lat) else e.pickup_lat end,
         case when j.pricing_basis in ('transport_only', 'transport_request') then public.coarse_coord(e.pickup_lng) else e.pickup_lng end,
         public.coarse_place(e.delivery_address), public.coarse_coord(e.delivery_lat), public.coarse_coord(e.delivery_lng),
         e.budget, e.preferred_date, e.repositioning_km, e.next_load_km, e.empty_km_saved, e.capacity_tier,
         e.capacity_trips, e.recommendation_tier
    from public._find_next_loads_exact(_driver_id, _current_job_id) e
    left join public.jobs j on j.id = e.job_id
$$;

create or replace function public.accept_bid(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- (0117) Also covers any offer that predates the insert guard.
  if _bid.driver_id = _job.customer_id then
    raise exception 'You can''t accept your own offer.' using errcode = '42501';
  end if;

  -- (0109) An offer past its expiry can no longer be accepted, whatever the
  -- trigger does. Checked after the row locks, against the live database clock.
  if _bid.expires_at is not null and _bid.expires_at < clock_timestamp() then
    raise exception 'This offer has expired. Ask the driver to send it again.'
      using errcode = '42501';
  end if;

  -- F1: never let an invalid price become the job's final price.
  if not public.is_valid_money(_bid.price) then
    raise exception 'This offer has an invalid price and cannot be accepted.';
  end if;

  -- (0101) No inventory reservation: supplier stock is advisory and is neither checked nor changed here.

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
