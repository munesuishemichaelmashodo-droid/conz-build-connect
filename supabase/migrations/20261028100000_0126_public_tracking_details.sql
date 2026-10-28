-- -----------------------------------------------------------------------------
-- 0126: the shared tracking link shows step times, the truck's direction and the
-- line driven since loading; a cancelled link says "cancelled".
--
-- No DROP (CREATE OR REPLACE; grants are restated). Deploy the app first (it reads the
-- new fields when present and copes with them missing), then apply this.
-- Undo: supabase/rollbacks/20261028100000_0126_rollback.sql (production definition of
-- 28/10/2026, read live).
--
-- Adds to get_public_tracking (anon, token-gated, unchanged access rules):
--   times.loaded_at    jobs.pickup_photo_taken_at (the pickup photo)
--   times.arrived_at   jobs.driver_arrived_dropoff_at
--   times.delivered_at jobs.completed_at
--   live.heading       driver_locations.heading rounded to 15 degrees
--   trail              job_route_points recorded after loading, only while in_progress,
--                      thinned to at most ~200 points, rounded to 4 decimals (~11 m)
-- Cancelled jobs now return {"status":"cancelled"} only (before: null, so the page said
-- "link not found"). Still nothing for unknown tokens or 90 days after completion.
-- Never returned: pickup point, customer, prices, PIN, driver phone. pgTAP 580.
-- -----------------------------------------------------------------------------

create or replace function public.get_public_tracking(_token uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  j record;
  _live_lat numeric;
  _live_lng numeric;
  _live_heading double precision;
  _live_updated_at timestamptz;
  _n int := 0;
  _step int := 1;
  _trail json;
begin
  select id, status, material, custom_material, quantity_m3, delivery_address,
         delivery_lat, delivery_lng, preferred_date, driver_id, completed_at,
         pickup_photo_taken_at, driver_arrived_dropoff_at
    into j
  from public.jobs
  where tracking_token = _token;

  if not found then
    return null;
  end if;

  if j.status = 'cancelled' then
    return json_build_object('status', 'cancelled');
  end if;

  if j.status = 'completed'
     and coalesce(j.completed_at, now()) < now() - interval '90 days'
  then
    return null;
  end if;

  if j.status in ('accepted', 'in_progress') then
    select lat, lng, heading, updated_at
      into _live_lat, _live_lng, _live_heading, _live_updated_at
    from public.driver_locations
    where job_id = j.id;
  end if;

  if j.status = 'in_progress' and j.pickup_photo_taken_at is not null then
    select count(*) into _n
    from public.job_route_points
    where job_id = j.id and recorded_at >= j.pickup_photo_taken_at;

    if _n > 0 then
      _step := greatest(1, ceil(_n / 200.0)::int);
      select json_agg(json_build_array(round(t.lat::numeric, 4), round(t.lng::numeric, 4))
                      order by t.recorded_at)
        into _trail
      from (
        select lat, lng, recorded_at, row_number() over (order by recorded_at) as rn
        from public.job_route_points
        where job_id = j.id and recorded_at >= j.pickup_photo_taken_at
      ) t
      where (t.rn - 1) % _step = 0 or t.rn = _n;
    end if;
  end if;

  return json_build_object(
    'status', j.status,
    'material', j.material,
    'custom_material', j.custom_material,
    'quantity_m3', j.quantity_m3,
    'delivery_address', j.delivery_address,
    'delivery_lat', j.delivery_lat,
    'delivery_lng', j.delivery_lng,
    'preferred_date', j.preferred_date,
    'driver_name', (select full_name from public.profiles where id = j.driver_id),
    'times', json_build_object(
      'loaded_at', j.pickup_photo_taken_at,
      'arrived_at', j.driver_arrived_dropoff_at,
      'delivered_at', j.completed_at
    ),
    'live',
      case
        when _live_lat is null then null
        else json_build_object(
          'lat', _live_lat,
          'lng', _live_lng,
          'heading', case when _live_heading is null then null
                          else ((round(_live_heading / 15.0) * 15)::int % 360) end,
          'updated_at', _live_updated_at
        )
      end,
    'trail', _trail
  );
end;
$function$;

revoke all on function public.get_public_tracking(uuid) from public;
grant execute on function public.get_public_tracking(uuid) to anon, authenticated, service_role;
