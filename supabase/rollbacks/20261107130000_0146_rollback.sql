-- Undo 0146. Contains DROP: run in the SQL editor.
-- create_dispatch_wave: copied verbatim from 0089 (live md5 0cec3ec1034fa8fabd0d98e8420e0fa6, whitespace stripped).
-- expire_stale_dispatch_offers: copied verbatim from the 13/08 baseline (live md5 4508d7f86fe65357ab6affa3c56e7f97).
-- ACLs are untouched by create or replace (both stay service_role only).
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

CREATE OR REPLACE FUNCTION public.expire_stale_dispatch_offers(_job_id uuid)
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
     SET status = 'expired', responded_at = now()
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

drop function if exists public.mark_dispatch_offer_viewed(uuid);
drop function if exists public.admin_dispatch_summary(integer);
alter table public.job_dispatch_offers drop column if exists viewed_at;
