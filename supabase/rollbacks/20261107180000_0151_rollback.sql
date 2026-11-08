-- Undo 0151: restores create_dispatch_wave exactly as 0146 left it (md5, whitespace stripped:
-- 61893547b550f93c0ccadae5601419af). create or replace only; no DROP needed.
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
