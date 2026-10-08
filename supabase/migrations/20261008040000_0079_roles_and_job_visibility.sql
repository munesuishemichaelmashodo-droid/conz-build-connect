-- =============================================================================
-- 0079 — Roles, open-job visibility and tracking tokens (audit F8)
-- =============================================================================
--
-- Problems (verified 07-08/10/2026):
--   * The 'driver' role is self-grantable (self_add_base_role, sign-up
--     metadata) as an applicant marker, but "Jobs visibility" let ANY holder
--     read every open job — delivery address, coordinates, notes and
--     tracking_token — before any verification.
--   * driver_available_jobs only required a driver_profiles row (anyone can
--     create a pending one) and returned the same data; find_next_loads_for_driver
--     only required auth.uid() = _driver_id.
--   * tracking_token never changed and never expired: a token read while the
--     job was open later revealed the assigned driver's live location, and
--     tracking links kept working forever (including for cancelled jobs).
--   * admin_grant_role could grant admin/super_admin with a password-only session.
--
-- Fix:
--   1. is_verified_driver(uid): driver role + verified profile + not past
--      re-verification. Open-job reads (policy + RPCs) require it.
--   2. tracking_token rotated when a job leaves 'open' (accepted), so only the
--      customer, the assigned driver and admins ever see the live token;
--      get_public_tracking returns nothing for cancelled jobs or 90 days after
--      completion.
--   3. Granting admin / super_admin requires MFA.
--   The 'driver' role stays self-grantable as an applicant marker (the
--   become-driver flow depends on it); everything it unlocks is now gated on
--   verification instead.
--
-- Function bodies for driver_available_jobs / find_next_loads_for_driver /
-- get_public_tracking are the live definitions with only the marked F8 lines.
-- =============================================================================

create or replace function public.is_verified_driver(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select _uid is not null
     and public.has_role(_uid, 'driver'::public.app_role)
     and exists (select 1 from public.driver_profiles dp
                  where dp.user_id = _uid
                    and dp.verification_status = 'verified'
                    and (dp.reverify_due_at is null or dp.reverify_due_at > now()))
$$;
revoke all on function public.is_verified_driver(uuid) from public, anon;
grant execute on function public.is_verified_driver(uuid) to authenticated, service_role;

drop policy if exists "Jobs visibility" on public.jobs;
create policy "Jobs visibility" on public.jobs
  for select to authenticated
  using (
    customer_id = auth.uid()
    or driver_id = auth.uid()
    or (status = 'open'::job_status and public.is_verified_driver(auth.uid()))
    or public.has_role(auth.uid(), 'admin'::app_role)
    or public.has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE OR REPLACE FUNCTION public.driver_available_jobs(_limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, material text, custom_material text, quantity_m3 numeric, budget numeric, delivery_address text, delivery_lat double precision, delivery_lng double precision, preferred_date date, notes text, created_at timestamp with time zone, expires_at timestamp with time zone, bid_count bigint, my_bid_id uuid, my_bid_price numeric, my_offer_id uuid, offer_expires_at timestamp with time zone, commission_due numeric, can_afford boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _rate  numeric;
  _avail numeric;
  _free  boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  -- must be a driver
  if not exists (select 1 from public.driver_profiles where user_id = auth.uid()) then
    raise exception 'Driver profile required';
  end if;

  -- F8 (0079): open-job addresses are for VERIFIED drivers only. A pending
  -- applicant (anyone can create a pending profile) gets an empty list.
  if not public.is_verified_driver(auth.uid()) then
    return;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  _rate := coalesce(_rate, 0);

  select coalesce(balance,0) - coalesce(held,0) into _avail
    from public.wallets where user_id = auth.uid();
  _avail := coalesce(_avail, 0);

  select coalesce(first_job_free_used, false) into _free
    from public.driver_profiles where user_id = auth.uid();

  return query
  select
    j.id,
    j.material::text,
    j.custom_material,
    j.quantity_m3,
    j.budget,
    j.delivery_address,
    j.delivery_lat,
    j.delivery_lng,
    j.preferred_date,
    j.notes,
    j.created_at,
    j.expires_at,
    (select count(*) from public.bids b where b.job_id = j.id
       and b.status = 'pending')                                as bid_count,
    mb.id                                                       as my_bid_id,
    mb.price                                                    as my_bid_price,
    off.id                                                      as my_offer_id,
    off.expires_at                                              as offer_expires_at,
    case when _free then round(coalesce(j.budget,0) * _rate / 100.0, 2)
         else 0 end                                             as commission_due,
    case when not _free then true
         else _avail >= round(coalesce(j.budget,0) * _rate / 100.0, 2)
    end                                                         as can_afford
  from public.jobs j
  left join lateral (
    select b.id, b.price from public.bids b
     where b.job_id = j.id and b.driver_id = auth.uid()
       and b.status = 'pending'
     limit 1
  ) mb on true
  left join lateral (
    select o.id, o.expires_at from public.job_dispatch_offers o
     where o.job_id = j.id and o.driver_id = auth.uid()
       and o.status = 'pending' and o.expires_at > now()
     limit 1
  ) off on true
  where j.status = 'open'
    and j.driver_id is null                       -- not already taken
    and (j.expires_at is null or j.expires_at > now())
    and j.customer_id <> auth.uid()               -- never your own job
  order by
    (off.id is not null) desc,                    -- direct offers first
    j.created_at desc
  limit  greatest(1, least(_limit, 100))
  offset greatest(0, _offset);
end $function$;

CREATE OR REPLACE FUNCTION public.find_next_loads_for_driver(_driver_id uuid, _current_job_id uuid)
 RETURNS TABLE(job_id uuid, material material_category, quantity_m3 numeric, pickup_address text, pickup_lat double precision, pickup_lng double precision, delivery_address text, delivery_lat double precision, delivery_lng double precision, budget numeric, preferred_date date, repositioning_km numeric, next_load_km numeric, empty_km_saved numeric, capacity_tier text, capacity_trips integer, recommendation_tier text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _is_authorized boolean;
  _anchor_lat double precision;
  _anchor_lng double precision;
  _anchor_date date;
  _origin_lat double precision;
  _origin_lng double precision;
begin
  _is_authorized := auth.uid() = _driver_id
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if not _is_authorized then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  -- F8 (0079): only verified drivers (or admins) get open-job suggestions.
  if not public.is_verified_driver(_driver_id)
     and not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    return;
  end if;

  -- Anchor: current job's delivery point (where the driver is / will be).
  -- Origin: current job's OWN pickup point -- the one real, already-known
  -- prior location, used only as the empty_km_saved comparison baseline,
  -- never presented as the driver's actual home base.
  select j.delivery_lat, j.delivery_lng, j.preferred_date, j.pickup_lat, j.pickup_lng
    into _anchor_lat, _anchor_lng, _anchor_date, _origin_lat, _origin_lng
  from public.jobs j
  where j.id = _current_job_id
    and j.driver_id = _driver_id
    and j.status in ('in_progress', 'completed');

  if _anchor_lat is null or _anchor_lng is null then
    return;
  end if;

  return query
  with candidates as (
    select
      j.id,
      j.material,
      j.quantity_m3,
      j.pickup_address,
      j.pickup_lat,
      j.pickup_lng,
      j.delivery_address,
      j.delivery_lat,
      j.delivery_lng,
      j.budget,
      j.preferred_date,
      round((2 * 6371 * asin(sqrt(
        power(sin(radians(j.pickup_lat - _anchor_lat) / 2), 2) +
        cos(radians(_anchor_lat)) * cos(radians(j.pickup_lat)) *
        power(sin(radians(j.pickup_lng - _anchor_lng) / 2), 2)
      )))::numeric, 1) as repositioning_km,
      case when j.delivery_lat is not null and j.delivery_lng is not null then
        round((2 * 6371 * asin(sqrt(
          power(sin(radians(j.delivery_lat - j.pickup_lat) / 2), 2) +
          cos(radians(j.pickup_lat)) * cos(radians(j.delivery_lat)) *
          power(sin(radians(j.delivery_lng - j.pickup_lng) / 2), 2)
        )))::numeric, 1)
      end as next_load_km,
      cap.tier as capacity_tier,
      cap.trips as capacity_trips,
      -- distance(candidate_delivery, origin) -- only computable when both
      -- the origin and the candidate's own delivery coordinates exist.
      case when _origin_lat is not null and _origin_lng is not null
                and j.delivery_lat is not null and j.delivery_lng is not null then
        (2 * 6371 * asin(sqrt(
          power(sin(radians(j.delivery_lat - _origin_lat) / 2), 2) +
          cos(radians(_origin_lat)) * cos(radians(j.delivery_lat)) *
          power(sin(radians(j.delivery_lng - _origin_lng) / 2), 2)
        )))
      end as _dist_candidate_delivery_to_origin
    from public.jobs j
    left join lateral (
      select
        case
          when trips_calc.trips > 1 then 'multiple_trips'
          when trips_calc.score >= 0.833 then 'excellent'
          when trips_calc.score >= 0.5 then 'good'
          else 'oversized'
        end as tier,
        trips_calc.trips
      from (
        select
          ceil(j.quantity_m3 / t.capacity_m3)::int as trips,
          j.quantity_m3 / (ceil(j.quantity_m3 / t.capacity_m3) * t.capacity_m3) as score
        from public.trucks t
        where t.driver_id = _driver_id and t.capacity_m3 > 0
        order by
          (case when ceil(j.quantity_m3 / t.capacity_m3) > 1 then 3
                when j.quantity_m3 / (ceil(j.quantity_m3 / t.capacity_m3) * t.capacity_m3) >= 0.833 then 0
                when j.quantity_m3 / (ceil(j.quantity_m3 / t.capacity_m3) * t.capacity_m3) >= 0.5 then 1
                else 2 end),
          ceil(j.quantity_m3 / t.capacity_m3)
        limit 1
      ) trips_calc
    ) cap on true
    where j.status = 'open'
      and j.id <> _current_job_id
      and j.pickup_lat is not null and j.pickup_lng is not null
      and (2 * 6371 * asin(sqrt(
            power(sin(radians(j.pickup_lat - _anchor_lat) / 2), 2) +
            cos(radians(_anchor_lat)) * cos(radians(j.pickup_lat)) *
            power(sin(radians(j.pickup_lng - _anchor_lng) / 2), 2)
          ))) <= 150
      and (_anchor_date is null or j.preferred_date is null or j.preferred_date >= _anchor_date)
  )
  select
    c.id,
    c.material,
    c.quantity_m3,
    c.pickup_address,
    c.pickup_lat,
    c.pickup_lng,
    c.delivery_address,
    c.delivery_lat,
    c.delivery_lng,
    c.budget,
    c.preferred_date,
    c.repositioning_km,
    c.next_load_km,
    case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
      round(greatest(0,
        (2 * 6371 * asin(sqrt(
          power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
          cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
          power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
        )))
        - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
      )::numeric, 1)
    end as empty_km_saved,
    c.capacity_tier,
    c.capacity_trips,
    case
      when c.capacity_tier in ('excellent','good') and c.repositioning_km <= 30
        and coalesce(
          case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
            greatest(0,
              (2 * 6371 * asin(sqrt(
                power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
                cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
                power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
              )))
              - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
            )
          end, 0) >= 20
      then 'excellent'
      when c.capacity_tier in ('excellent','good','oversized')
        and coalesce(
          case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
            greatest(0,
              (2 * 6371 * asin(sqrt(
                power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
                cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
                power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
              )))
              - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
            )
          end, 0) > 0
      then 'good'
      else 'possible'
    end as recommendation_tier
  from candidates c
  order by
    case
      when c.capacity_tier in ('excellent','good') and c.repositioning_km <= 30 then 0
      else 1
    end,
    -- Primary ranking signal is empty_km_saved descending (the actual
    -- "productive journey" insight), not raw repositioning distance --
    -- this is the behavioural change from the previous version.
    coalesce(
      case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
        greatest(0,
          (2 * 6371 * asin(sqrt(
            power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
            cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
            power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
          )))
          - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
        )
      end, 0) desc,
    c.repositioning_km asc
  limit 10;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_tracking(_token uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j record;
  -- Plain scalars instead of a record: they default to NULL automatically
  -- when the conditional lookup below doesn't run (e.g. a completed job
  -- has no live location), unlike a `record` variable, which stays
  -- entirely unassigned and throws a hard error if any field on it is
  -- referenced later. That was crashing this function — and therefore the
  -- receipt page — for every completed job.
  _live_lat numeric;
  _live_lng numeric;
  _live_updated_at timestamptz;
begin
  select id, status, material, custom_material, quantity_m3,
         delivery_address, delivery_lat, delivery_lng, preferred_date, driver_id,
         completed_at
    into j
    from public.jobs
   where tracking_token = _token;

  if not found then
    return null;
  end if;

  -- F8 (0079): links stop working for cancelled jobs, and 90 days after
  -- completion (receipts). Tokens seen while a job was open are rotated on
  -- acceptance (trg_jobs_rotate_tracking_token), so they never reveal the
  -- assigned driver's live location.
  if j.status = 'cancelled' then
    return null;
  end if;
  if j.status = 'completed' and coalesce(j.completed_at, now()) < now() - interval '90 days' then
    return null;
  end if;

  if j.status in ('accepted','in_progress') then
    select lat, lng, updated_at into _live_lat, _live_lng, _live_updated_at
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
    'driver_name', (select full_name from public.profiles where id = j.driver_id),
    'live', case
              when _live_lat is null then null
              else json_build_object('lat', _live_lat, 'lng', _live_lng, 'updated_at', _live_updated_at)
            end
  );
end;
$function$;

-- Rotate the tracking token when the job is taken (open -> any other status).
-- Runs after the client guard (trigger names sort after jobs_guard_*), and
-- status only changes through the SECURITY DEFINER job RPCs.
create or replace function public.jobs_rotate_tracking_token()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if old.status = 'open' and new.status is distinct from old.status then
    new.tracking_token := gen_random_uuid();
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_rotate_tracking_token on public.jobs;
create trigger trg_jobs_rotate_tracking_token
  before update of status on public.jobs
  for each row execute function public.jobs_rotate_tracking_token();

CREATE OR REPLACE FUNCTION public.admin_grant_role(_user_id uuid, _role app_role, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can grant roles';
  END IF;
  -- F8 (0079): privileged roles need an MFA session to grant.
  IF _role IN ('admin', 'super_admin') THEN
    PERFORM public.require_aal2();
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  PERFORM public.log_admin_action('role_granted', jsonb_build_object('role', _role), _reason, NULL, _user_id);
END $function$;
