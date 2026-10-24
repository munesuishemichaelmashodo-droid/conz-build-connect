-- 0112: know where every load came from and how the trip went, for admins only.
--
-- PREPARED, NOT APPLIED. Owner decision 24/10/2026 ("build them, 2 km is fine").
-- Apply after the app release that sends the driver's "Where did you load?" answer
-- (it works without it too: open-request pickups are then flagged for admins).
-- No DROP statements (the Supabase tool hangs on DROP).
--
-- Why (read-only checks on production, 23-24/10/2026):
--   * Nothing compares where the driver actually loaded (the pickup photo's GPS) with
--     the expected supplier, so loading somewhere else goes unnoticed. 3 of 17 live
--     pickup photos have no location at all.
--   * "Driver arranges pickup" jobs (16 live) have no expected point, so where the load
--     came from is only known from the photo, if it has a location.
--   * driver_locations keeps only the latest position per job and is deleted after
--     24 hours, so a dispute cannot show the route that was driven.
--
-- What it adds (customers see and do nothing new):
--   1. job_pickup_checks: one row per job, written when the FIRST pickup photo is
--      recorded. Expected point = the job's supply location, else the job's pickup
--      point. Status: 'ok' (within 2 km), 'far' (more than 2 km), 'no_location'
--      (photo without GPS), 'no_expected_point' (driver-arranged pickup). 'far',
--      'no_location', and a driver-arranged pickup with no named source notify admins
--      (type 'pickup_check'). The check never blocks the photo.
--   2. set_job_loaded_at(job, name): the assigned driver names where they loaded
--      (quarry or supplier) on an active job. Stored on the check.
--   3. job_route_points: at most one point every 2 minutes from driver_locations while
--      the job is accepted or in progress. Kept 90 days (daily prune). Never blocks a
--      location update.
--   Both tables: admins (admin / super_admin) can read; nobody can write from the app
--   except through set_job_loaded_at.
--
-- Rollback: supabase/rollbacks/20261024100000_0112_rollback.sql.

-- -----------------------------------------------------------------------------
-- 1. Pickup checks
-- -----------------------------------------------------------------------------
create table if not exists public.job_pickup_checks (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  status text check (status in ('ok', 'far', 'no_location', 'no_expected_point')),
  expected_lat double precision,
  expected_lng double precision,
  expected_source text check (expected_source in ('supply_location', 'job_pickup_point')),
  photo_lat double precision,
  photo_lng double precision,
  photo_accuracy_m numeric,
  distance_m integer,
  evidence_id uuid,
  checked_at timestamptz,
  loaded_at_name text check (loaded_at_name is null or char_length(loaded_at_name) between 2 and 120),
  loaded_at_set_at timestamptz
);
alter table public.job_pickup_checks enable row level security;
revoke all on table public.job_pickup_checks from public, anon, authenticated;
grant select on table public.job_pickup_checks to authenticated;
grant select, insert, update, delete on table public.job_pickup_checks to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_pickup_checks'
                  and policyname = 'Admins read pickup checks') then
    create policy "Admins read pickup checks" on public.job_pickup_checks for select to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

create or replace function public.tg_pickup_check()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  _job public.jobs;
  _exp_lat double precision; _exp_lng double precision; _src text;
  _dist integer; _status text; _name text;
begin
  if new.kind <> 'pickup' then return new; end if;
  begin
    -- Only the first pickup photo is checked.
    if exists (select 1 from public.job_pickup_checks c where c.job_id = new.job_id and c.status is not null) then
      return new;
    end if;
    select * into _job from public.jobs where id = new.job_id;
    if _job.supply_location_id is not null then
      select l.lat, l.lng into _exp_lat, _exp_lng from public.material_supply_locations l
       where l.id = _job.supply_location_id and l.lat is not null and l.lng is not null;
      if _exp_lat is not null then _src := 'supply_location'; end if;
    end if;
    if _src is null and _job.pickup_lat is not null and _job.pickup_lng is not null then
      _exp_lat := _job.pickup_lat; _exp_lng := _job.pickup_lng; _src := 'job_pickup_point';
    end if;

    if new.device_lat is null or new.device_lng is null then
      _status := 'no_location';
    elsif _src is null then
      _status := 'no_expected_point';
    else
      _dist := round(2 * 6371000 * asin(least(1, sqrt(
                 power(sin(radians(new.device_lat - _exp_lat) / 2), 2) +
                 cos(radians(_exp_lat)) * cos(radians(new.device_lat)) *
                 power(sin(radians(new.device_lng - _exp_lng) / 2), 2)))));
      _status := case when _dist > 2000 then 'far' else 'ok' end;
    end if;

    insert into public.job_pickup_checks as c
      (job_id, status, expected_lat, expected_lng, expected_source, photo_lat, photo_lng,
       photo_accuracy_m, distance_m, evidence_id, checked_at)
    values (new.job_id, _status, _exp_lat, _exp_lng, _src, new.device_lat, new.device_lng,
            new.device_accuracy_m, _dist, new.id, now())
    on conflict (job_id) do update
      set status = excluded.status, expected_lat = excluded.expected_lat, expected_lng = excluded.expected_lng,
          expected_source = excluded.expected_source, photo_lat = excluded.photo_lat,
          photo_lng = excluded.photo_lng, photo_accuracy_m = excluded.photo_accuracy_m,
          distance_m = excluded.distance_m, evidence_id = excluded.evidence_id, checked_at = excluded.checked_at
    returning c.loaded_at_name into _name;

    if _status in ('far', 'no_location') or (_status = 'no_expected_point' and _name is null) then
      insert into public.notifications (user_id, type, title, body, job_id)
      select distinct ur.user_id, 'pickup_check',
             case _status when 'far' then 'Pickup far from the supplier'
                          when 'no_location' then 'Pickup photo has no location'
                          else 'Pickup source not named' end,
             case _status when 'far' then 'The pickup photo was taken ' || round(_dist / 1000.0, 1)::text
                                        || ' km from the expected supplier.'
                          when 'no_location' then 'The driver''s pickup photo has no GPS position.'
                          else 'The driver arranged this pickup and did not say where they loaded.' end,
             new.job_id
        from public.user_roles ur where ur.role in ('admin', 'super_admin');
    end if;
  exception when others then
    raise warning 'pickup check failed: %', sqlerrm;  -- never block the photo
  end;
  return new;
end $$;
revoke all on function public.tg_pickup_check() from public, anon, authenticated;

create or replace trigger trg_pickup_check
  after insert on public.job_evidence
  for each row execute function public.tg_pickup_check();

-- -----------------------------------------------------------------------------
-- 2. The driver names where they loaded
-- -----------------------------------------------------------------------------
create or replace function public.set_job_loaded_at(_job_id uuid, _name text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _clean text := btrim(coalesce(_name, ''));
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into _job from public.jobs where id = _job_id;
  if not found or _job.driver_id is distinct from auth.uid() then
    raise exception 'Only the assigned driver can say where the load came from.' using errcode = '42501';
  end if;
  if _job.status not in ('accepted', 'in_progress') then
    raise exception 'This job is no longer active.' using errcode = '42501';
  end if;
  if char_length(_clean) < 2 or char_length(_clean) > 120 then
    raise exception 'Say where you loaded: the name of the quarry or supplier.' using errcode = '22023';
  end if;
  insert into public.job_pickup_checks (job_id, loaded_at_name, loaded_at_set_at)
  values (_job_id, _clean, now())
  on conflict (job_id) do update set loaded_at_name = excluded.loaded_at_name, loaded_at_set_at = excluded.loaded_at_set_at;
end $$;
revoke all on function public.set_job_loaded_at(uuid, text) from public, anon;
grant execute on function public.set_job_loaded_at(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Route trail
-- -----------------------------------------------------------------------------
create table if not exists public.job_route_points (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  driver_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now()
);
create index if not exists job_route_points_job_time on public.job_route_points (job_id, recorded_at);
create index if not exists job_route_points_time on public.job_route_points (recorded_at);
alter table public.job_route_points enable row level security;
revoke all on table public.job_route_points from public, anon, authenticated;
grant select on table public.job_route_points to authenticated;
grant select, insert, update, delete on table public.job_route_points to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_route_points'
                  and policyname = 'Admins read route trails') then
    create policy "Admins read route trails" on public.job_route_points for select to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

create or replace function public.tg_record_route_point()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _last timestamptz;
begin
  begin
    if not exists (select 1 from public.jobs j where j.id = new.job_id and j.status in ('accepted', 'in_progress')) then
      return new;
    end if;
    select max(recorded_at) into _last from public.job_route_points where job_id = new.job_id;
    if _last is null or new.updated_at >= _last + interval '2 minutes' then
      insert into public.job_route_points (job_id, driver_id, lat, lng, accuracy, recorded_at)
      values (new.job_id, new.driver_id, new.lat, new.lng, new.accuracy, coalesce(new.updated_at, now()));
    end if;
  exception when others then
    raise warning 'route point failed: %', sqlerrm;  -- never block a location update
  end;
  return new;
end $$;
revoke all on function public.tg_record_route_point() from public, anon, authenticated;

create or replace trigger trg_record_route_point
  after insert or update on public.driver_locations
  for each row execute function public.tg_record_route_point();

create or replace function public.prune_job_route_points()
returns void language sql security definer set search_path to 'public' as $$
  delete from public.job_route_points where recorded_at < now() - interval '90 days';
$$;
revoke all on function public.prune_job_route_points() from public, anon, authenticated;
grant execute on function public.prune_job_route_points() to service_role;

-- Daily at 03:23. Dynamic SQL so this still parses on databases without pg_cron.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select cron.schedule('prune-job-route-points', '23 3 * * *', 'select public.prune_job_route_points();')
       where not exists (select 1 from cron.job where jobname = 'prune-job-route-points')
    $q$;
  end if;
end $$;
