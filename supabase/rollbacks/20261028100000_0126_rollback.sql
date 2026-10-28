-- Undo 0126: restores get_public_tracking exactly as it was live on 28/10/2026
-- (read with pg_get_functiondef; line endings normalised) and its grants
-- (EXECUTE for PUBLIC, anon, authenticated, service_role). No DROP.
create or replace function public.get_public_tracking(_token uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  j record;

  -- Plain scalars instead of a record: they default to NULL automatically
  -- when the conditional lookup below doesn't run.
  _live_lat numeric;
  _live_lng numeric;
  _live_updated_at timestamptz;

begin

  select
    id,
    status,
    material,
    custom_material,
    quantity_m3,
    delivery_address,
    delivery_lat,
    delivery_lng,
    preferred_date,
    driver_id,
    completed_at
    into j
  from public.jobs
  where tracking_token = _token;

  if not found then
    return null;
  end if;

  -- F8 (0079): links stop working for cancelled jobs,
  -- and 90 days after completion.
  if j.status = 'cancelled' then
    return null;
  end if;

  if j.status = 'completed'
     and coalesce(j.completed_at, now()) < now() - interval '90 days'
  then
    return null;
  end if;

  if j.status in ('accepted', 'in_progress') then
    select
      lat,
      lng,
      updated_at
      into
        _live_lat,
        _live_lng,
        _live_updated_at
    from public.driver_locations
    where job_id = j.id;
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
    'driver_name',
      (
        select full_name
        from public.profiles
        where id = j.driver_id
      ),
    'live',
      case
        when _live_lat is null then null
        else json_build_object(
          'lat', _live_lat,
          'lng', _live_lng,
          'updated_at', _live_updated_at
        )
      end
  );

end;
$function$;

grant execute on function public.get_public_tracking(uuid) to public, anon, authenticated, service_role;
