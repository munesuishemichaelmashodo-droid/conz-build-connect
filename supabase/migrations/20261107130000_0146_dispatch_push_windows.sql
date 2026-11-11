-- 0146 — dispatch offers that can actually be answered.
-- Evidence (production, 07/11): 94 offers, 74 expired, 0 accepted or declined. Offers lasted 10 s,
-- created no notification (so no push), and were only visible while the driver sat on the home screen.
-- Changes (no money, wallet, commission or escrow function is touched):
--   * create_dispatch_wave: window = 60 s when the driver's location was refreshed < 2 min ago (app open),
--     5 min otherwise (still inside the 15 min freshness rule, reachable by push); one 'dispatch_offer'
--     notification per offered driver (existing notifications -> send-push trigger delivers it). Area-only:
--     no street address, no coordinates.
--   * job_dispatch_offers.viewed_at + mark_dispatch_offer_viewed(): honest "seen" evidence, own offer only.
--   * expire_stale_dispatch_offers: expiry no longer writes responded_at (it was counted as a response).
--   * admin_dispatch_summary(days): offers created / viewed / accepted / declined / expired, median seconds to response.
-- Undo: supabase/rollbacks/20261107130000_0146_rollback.sql

alter table public.job_dispatch_offers add column if not exists viewed_at timestamptz;

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
           round(job_row.quantity_m3)::text || ' m³ delivery request. Open ConZ to accept or decline.',
           _job_id
      from ins i
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
end $$;

create or replace FUNCTION public.expire_stale_dispatch_offers(_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining integer;
  job_status text;
  waves_sent integer := 0;
BEGIN
  UPDATE public.job_dispatch_offers
     SET status = 'expired'  -- 0146: expiry is not a driver response
   WHERE job_id = _job_id AND status = 'pending' AND expires_at < now();

  SELECT status INTO job_status FROM public.jobs WHERE id = _job_id;
  IF job_status <> 'open' THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO remaining
  FROM public.job_dispatch_offers
  WHERE job_id = _job_id AND status = 'pending';

  IF remaining = 0 THEN
    waves_sent := public.create_dispatch_wave(_job_id, 5);
  END IF;

  RETURN waves_sent;
END;
$function$
;

create or replace function public.mark_dispatch_offer_viewed(_offer_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.job_dispatch_offers set viewed_at = coalesce(viewed_at, now())
   where id = _offer_id and driver_id = auth.uid();
  if not found then raise exception 'Not your offer'; end if;
end $$;
revoke all on function public.mark_dispatch_offer_viewed(uuid) from public, anon;
grant execute on function public.mark_dispatch_offer_viewed(uuid) to authenticated, service_role;

create or replace function public.admin_dispatch_summary(_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare r jsonb;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Admins only';
  end if;
  select jsonb_build_object(
    'offers', count(*),
    'viewed', count(*) filter (where viewed_at is not null),
    'accepted', count(*) filter (where status = 'accepted'),
    'declined', count(*) filter (where status = 'rejected'),
    'expired', count(*) filter (where status = 'expired'),
    'median_response_seconds', (percentile_cont(0.5) within group
       (order by extract(epoch from responded_at - offered_at))
       filter (where status in ('accepted','rejected')))::int)
  into r from public.job_dispatch_offers
   where offered_at > now() - make_interval(days => greatest(1, least(coalesce(_days, 7), 90)));
  return r;
end $$;
revoke all on function public.admin_dispatch_summary(integer) from public, anon;
grant execute on function public.admin_dispatch_summary(integer) to authenticated, service_role;
