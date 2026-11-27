-- -----------------------------------------------------------------------------
-- 0195: dispatch eligibility, busy drivers, commission credit (owner decisions 27/11/2026).
--
-- One set of driver checks (_dispatch_driver_checks) now decides targeted invitations, the "new job" broadcast and
-- the admin explanation, and the same busy / commission rules are enforced on every offer write:
--   * Truck type: a job's "truck needed" (0183) is respected by invitations and next-load suggestions. A truck of a
--     different recorded type does not qualify; a truck with no recorded type is not excluded.
--   * Commission Credit: a driver whose available credit (purchased + promotional, minus reserves) does not cover the
--     7% commission is not invited, not sent the broadcast, and cannot send or raise an offer they could not fulfil
--     (checked on the OFFER price). Provider-paid jobs and the retired free-first-job flag keep their existing rule.
--   * Busy drivers (owner option 1): a driver with an accepted or in-progress job may browse, but cannot send an
--     offer (or move one back to pending, or accept a counter), is not invited and not sent the broadcast. When a
--     driver is assigned a job, their other pending offers are withdrawn and their pending invitations superseded.
--     Eligibility returns by itself after completion or cancellation (it is computed, not stored).
--   * Invitations stay invitations: accepting one still only creates an offer the customer chooses from (0154).
--   * Invitation and broadcast text name a custom / transport-only load by its description (contact-redacted).
--   * admin_dispatch_eligibility(job): admins only, read-only: every driver, distance, and why they are or are not
--     eligible, with their invitation status.
-- The one-active-job trigger (0144) and accept_bid's checks stay as the last line of defence.
--   * accept_bid takes the driver's assignment lock before locking the offer (no deadlock between two customers).
-- No pricing, commission rate or payment change. No DROP, no DELETE. Undo: supabase/rollbacks/20261127160000_0195_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Helpers (internal: not callable by clients) -------------------------------------------------------------
create or replace function public.driver_is_busy(_driver_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.jobs j where j.driver_id = _driver_id and j.status in ('accepted', 'in_progress'))
$$;
revoke all on function public.driver_is_busy(uuid) from public, anon, authenticated;

-- Same rule as driver_can_accept_for, for a given price (the offer price), without the caller check.
create or replace function public.driver_commission_covered(_driver_id uuid, _job_id uuid, _price numeric)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare _job public.jobs; _used boolean; _rate numeric; _avail numeric;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return false; end if;
  if _job.payment_method = 'provider' then return true; end if;
  select first_job_free_used into _used from public.driver_profiles where user_id = _driver_id;
  if not found then return false; end if;
  if _used is not true then return true; end if;
  select (value::text)::numeric into _rate from public.system_settings where key = 'commission_rate';
  if _rate is null then return false; end if;
  select coalesce(balance, 0) - coalesce(held, 0) - coalesce(withdrawal_reserved, 0) + coalesce(promo_balance, 0)
    into _avail from public.wallets where user_id = _driver_id;
  return coalesce(_avail, 0) >= public.commission_amount(coalesce(_price, 0), _rate);
end $$;
revoke all on function public.driver_commission_covered(uuid, uuid, numeric) from public, anon, authenticated;

-- 2. One set of driver checks for a job ----------------------------------------------------------------------
create or replace function public._dispatch_driver_checks(_job_id uuid)
returns table(driver_id uuid, pickup_km numeric, capacity_m3 numeric, reasons text[])
language sql stable security definer set search_path to 'public' as $$
  with j as (
    select jb.id, jb.customer_id, jb.truck_requirement, coalesce(jb.final_price, jb.budget) as price,
           coalesce(jb.pickup_lat, jb.delivery_lat) as lat, coalesce(jb.pickup_lng, jb.delivery_lng) as lng
      from public.jobs jb where jb.id = _job_id
  )
  select ur.user_id,
         case when d.km is not null then round(d.km::numeric, 2) end,
         tr.cap,
         array_remove(array[
           case when dp.user_id is null or dp.verification_status <> 'verified' then 'not_verified' end,
           case when dp.reverify_due_at is not null and dp.reverify_due_at <= now() then 'reverification_due' end,
           case when p.id is null or p.status <> 'active' or p.deleted_at is not null then 'account_inactive' end,
           case when p.restricted_until is not null and p.restricted_until > now() then 'restricted' end,
           case when w.user_id is null or w.limited then 'credit_account_limited' end,
           case when a.driver_id is null or not a.is_available then 'offline' end,
           case when a.is_available and (a.lat is null or a.lng is null or a.updated_at <= now() - interval '15 minutes')
                then 'location_stale' end,
           case when tall.n = 0 then 'no_truck' when tr.cap is null then 'truck_type_mismatch' end,
           case when ur.user_id = j.customer_id then 'own_job' end,
           case when public.driver_is_busy(ur.user_id) then 'busy' end,
           case when not public.driver_commission_covered(ur.user_id, j.id, j.price) then 'insufficient_commission_credit' end,
           case when j.lat is null or j.lng is null then 'job_has_no_location' end
         ]::text[], null)
    from j
    join public.user_roles ur on ur.role = 'driver'
    left join public.driver_profiles dp on dp.user_id = ur.user_id
    left join public.profiles p on p.id = ur.user_id
    left join public.wallets w on w.user_id = ur.user_id
    left join public.driver_availability a on a.driver_id = ur.user_id
    cross join lateral (select count(*) as n from public.trucks t
                         where t.driver_id = ur.user_id and t.capacity_m3 > 0) tall
    cross join lateral (
      select max(t.capacity_m3) as cap from public.trucks t
       where t.driver_id = ur.user_id and t.capacity_m3 > 0
         and (coalesce(j.truck_requirement, 'any') = 'any' or t.body_type is null or t.body_type = j.truck_requirement)) tr
    cross join lateral (
      select case when a.lat is not null and a.lng is not null and j.lat is not null and j.lng is not null then
        2 * 6371 * asin(least(1, sqrt(
          power(sin(radians(a.lat - j.lat) / 2), 2) +
          cos(radians(j.lat)) * cos(radians(a.lat)) *
          power(sin(radians(a.lng - j.lng) / 2), 2)))) end as km) d
$$;
revoke all on function public._dispatch_driver_checks(uuid) from public, anon, authenticated;

-- 3. Invitations use the checks (same signature and ordering as before) ---------------------------------------
create or replace function public.eligible_dispatch_drivers(_job_id uuid, _radius_km numeric)
returns table(driver_id uuid, pickup_km numeric, capacity_m3 numeric)
language sql stable security definer set search_path to 'public' as $$
  select c.driver_id, c.pickup_km, c.capacity_m3
    from public._dispatch_driver_checks(_job_id) c
   where exists (select 1 from public.jobs jb where jb.id = _job_id and jb.status = 'open')
     and cardinality(c.reasons) = 0
     and c.pickup_km <= _radius_km
   order by c.pickup_km asc
$$;


-- 4. Every offer write: no offers from busy drivers, none the driver's credit cannot cover ---------------------
create or replace function public.tg_bids_driver_eligibility()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and not (new.status = 'pending'
       and (old.status is distinct from 'pending' or new.price is distinct from old.price)) then
    return new;
  end if;
  if new.status is distinct from 'pending' then return new; end if;
  -- Applies to every write made for a signed-in user (directly, or through accept_counter, accept_dispatch_offer and
  -- other functions they call). Rows written by the database owner or service jobs (no signed-in user) are not
  -- driver offers and keep their own checks.
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  -- an invalid amount is refused by the existing price checks with their own message
  if not public.is_valid_money(new.price) then return new; end if;
  if public.driver_is_busy(new.driver_id) then
    raise exception 'DRIVER_BUSY: you are on another job. Finish it before sending offers.' using errcode = 'P0001';
  end if;
  if not public.driver_commission_covered(new.driver_id, new.job_id, new.price) then
    raise exception 'COMMISSION_CREDIT: your Commission Credit does not cover the commission on this offer. Top up or offer a lower price.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_bids_driver_eligibility() from public, anon, authenticated;
create or replace trigger trg_bids_driver_eligibility
  before insert or update of status, price on public.bids
  for each row execute function public.tg_bids_driver_eligibility();

-- 5. Assigned: withdraw the driver's other pending offers and invitations ------------------------------------
create or replace function public.tg_jobs_withdraw_assigned_driver_offers()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'accepted' and new.driver_id is not null
     and (old.status is distinct from 'accepted' or old.driver_id is distinct from new.driver_id) then
    update public.bids set status = 'withdrawn'
     where driver_id = new.driver_id and job_id <> new.id and status = 'pending';
    update public.job_dispatch_offers set status = 'superseded', responded_at = now()
     where driver_id = new.driver_id and job_id <> new.id and status = 'pending';
  end if;
  return new;
end $$;
revoke all on function public.tg_jobs_withdraw_assigned_driver_offers() from public, anon, authenticated;
create or replace trigger trg_jobs_withdraw_assigned_driver_offers
  after update of status, driver_id on public.jobs
  for each row execute function public.tg_jobs_withdraw_assigned_driver_offers();

-- 5b. accept_bid: driver lock first (no deadlock when two customers accept the same driver at once) -------------
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

  -- 0195: take the driver's assignment lock (the same one tg_one_active_job_per_driver uses) BEFORE locking the
  -- offer, so two customers accepting the same driver at once queue instead of deadlocking: the second then finds
  -- the offer withdrawn (or the driver busy) and gets a clean refusal.
  select driver_id into _bid.driver_id from public.bids where id = _bid_id;
  if _bid.driver_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('conz:driver_active_job:' || _bid.driver_id::text, 0));
  end if;
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

-- 6. Admin explanation (read-only) ----------------------------------------------------------------------------
create or replace function public.admin_dispatch_eligibility(_job_id uuid)
returns table(driver_id uuid, driver_name text, pickup_km numeric, capacity_m3 numeric, current_radius_km numeric,
              eligible_now boolean, reasons text[], invitation_status text, invited_at timestamptz, wave integer)
language plpgsql stable security definer set search_path to 'public' as $$
declare _radius numeric; _created timestamptz; _status text;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select created_at, status::text into _created, _status from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found.' using errcode = 'P0002'; end if;
  select s.radius_km into _radius from public.dispatch_stage_for(_created) s;
  return query
  select c.driver_id, p.full_name, c.pickup_km, c.capacity_m3, _radius,
         (_status = 'open' and cardinality(c.reasons) = 0 and c.pickup_km <= _radius),
         c.reasons || case when c.pickup_km > _radius then array['outside_current_radius'] else array[]::text[] end
                   || case when _status <> 'open' then array['job_not_open'] else array[]::text[] end,
         o.status::text, o.offered_at, o.wave
    from public._dispatch_driver_checks(_job_id) c
    left join public.profiles p on p.id = c.driver_id
    left join lateral (select x.status, x.offered_at, x.wave from public.job_dispatch_offers x
                        where x.job_id = _job_id and x.driver_id = c.driver_id
                        order by x.offered_at desc limit 1) o on true
   order by (cardinality(c.reasons) = 0) desc, c.pickup_km nulls last;
end $$;
revoke all on function public.admin_dispatch_eligibility(uuid) from public, anon;
grant execute on function public.admin_dispatch_eligibility(uuid) to authenticated;

-- 7. Invitation and broadcast text; next loads respect truck type -------------------------------------------
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
  -- 0195: a custom / transport-only load is announced by its own description (contact details removed).
  _mat := case when job_row.material::text = 'custom'
               then coalesce(nullif(left(btrim(public.redact_contacts(job_row.custom_material)), 60), ''), 'Load')
               else replace(job_row.material::text, '_', ' ') end;
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
      coalesce(new.quantity_m3::text || 'm³ ', '') || case when new.material::text = 'custom'
             then coalesce(nullif(left(btrim(public.redact_contacts(new.custom_material)), 60), ''), 'Load')
             else replace(new.material::text, '_', ' ') end ||
        ' delivery to ' || coalesce(public.coarse_place(coalesce(new.dropoff_address, new.delivery_address)), 'a nearby area'),
      new.id
    from public.user_roles ur
    join public.driver_profiles dp on dp.user_id = ur.user_id
    where ur.role = 'driver'
      and dp.verification_status = 'verified'
      and (dp.reverify_due_at is null or dp.reverify_due_at > now())
      and ur.user_id <> new.customer_id
      -- 0195: not to drivers who could not send an offer on it
      and not public.driver_is_busy(ur.user_id)
      and public.driver_commission_covered(ur.user_id, new.id, coalesce(new.final_price, new.budget));
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
   -- 0195: only loads one of the driver's trucks can do (a truck with no recorded type is not excluded)
   where coalesce(j.truck_requirement, 'any') = 'any'
      or exists (select 1 from public.trucks t
                  where t.driver_id = _driver_id and t.capacity_m3 > 0
                    and (t.body_type is null or t.body_type = j.truck_requirement))
$$;
