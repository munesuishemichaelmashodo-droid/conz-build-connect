-- -----------------------------------------------------------------------------
-- 0133: exact delivery location and customer details stay private until a driver is selected.
--
-- Defect (confirmed 03/11/2026): the jobs policy let every verified driver read the WHOLE row of
-- every open job (delivery_address, delivery_lat/lng, notes, receiver_name, tracking_token, ...), and
-- driver_available_jobs / find_next_loads_for_driver returned the exact address and coordinates.
--
-- Fix (no data is moved or copied; one source of truth stays in public.jobs):
--   1. The jobs SELECT policy no longer lets a driver read other people's open jobs. A driver can read
--      a job row only when they are the assigned driver AND the job is accepted / in progress / completed.
--      A cancelled job or a reassignment therefore closes the door again. Customers and admins unchanged.
--   2. Unselected drivers use area-only functions: driver_open_jobs / driver_open_job (masked rows),
--      driver_available_jobs and find_next_loads_for_driver (same signatures, masked output).
--      Masked = area name (suburb, city) instead of the address, coordinates rounded to 2 decimals
--      (about 1 km), phone numbers and e-mail addresses removed from notes, no tracking token, PIN,
--      receiver name or drop-off details.
--   3. Selection already assigns a driver only inside accept_bid / accept_dispatch_offer AFTER the
--      commission reservation succeeds, so a failed reservation never unlocks anything.
-- The original bodies are kept (renamed, execute revoked) so behaviour and the live-only 0079 edit are preserved.
-- No DROP. Undo: supabase/rollbacks/20261103150000_0133_rollback.sql
-- -----------------------------------------------------------------------------

begin;

-- Masking helpers (internal) -----------------------------------------------------------------
create or replace function public.coarse_coord(_v double precision)
returns double precision language sql immutable set search_path to 'public' as
$$ select case when _v is null then null else round(_v::numeric, 2)::double precision end $$;

-- "12 Harward Rd, Belvedere, Harare, Zimbabwe" -> "Belvedere, Harare"
create or replace function public.coarse_place(_address text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare _parts text[]; _p text; _keep text[] := '{}'; _n int;
begin
  select coalesce(array_agg(btrim(x)), '{}') into _parts
    from unnest(string_to_array(coalesce(_address, ''), ',')) x
   where btrim(x) <> '' and lower(btrim(x)) <> 'zimbabwe';
  _n := coalesce(array_length(_parts, 1), 0);
  if _n = 0 then return null; end if;
  for _p in select unnest(_parts[greatest(1, _n - 1):_n]) loop
    if _p !~ '[0-9]' then _keep := _keep || _p; end if;   -- drop anything that looks like a street number
  end loop;
  if array_length(_keep, 1) is null then return 'Area shared once you are selected'; end if;
  return array_to_string(_keep, ', ');
end $$;

create or replace function public.redact_contacts(_t text)
returns text language sql immutable set search_path to 'public' as $$
  select case when _t is null then null else
    regexp_replace(regexp_replace(_t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contact hidden]', 'g'),
                   '(\+?\d[\d\s().-]{6,}\d)', '[contact hidden]', 'g') end $$;

create or replace function public.mask_job_for_driver(j public.jobs)
returns public.jobs language plpgsql immutable set search_path to 'public' as $$
begin
  j.delivery_address := public.coarse_place(j.delivery_address);
  j.delivery_lat := public.coarse_coord(j.delivery_lat);
  j.delivery_lng := public.coarse_coord(j.delivery_lng);
  j.dropoff_address := null; j.dropoff_lat := null; j.dropoff_lng := null;
  j.notes := public.redact_contacts(j.notes);
  j.receiver_name := null;
  j.tracking_token := null;
  j.delivery_pin := null;
  j.delivery_photo_url := null; j.pickup_photo_url := null;
  return j;
end $$;

revoke all on function public.coarse_coord(double precision) from public, anon, authenticated;
revoke all on function public.coarse_place(text) from public, anon, authenticated;
revoke all on function public.redact_contacts(text) from public, anon, authenticated;
revoke all on function public.mask_job_for_driver(public.jobs) from public, anon, authenticated;

-- Area-only job access for drivers -------------------------------------------------------------
create or replace function public.driver_open_jobs(_limit integer default 50, _offset integer default 0)
returns setof public.jobs
language plpgsql stable security definer set search_path to 'public'
as $$
declare j public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if not public.is_verified_driver(auth.uid()) then return; end if;
  for j in
    select * from public.jobs
     where status = 'open' and driver_id is null and customer_id <> auth.uid()
       and (expires_at is null or expires_at > now())
     order by created_at desc
     limit greatest(1, least(_limit, 100)) offset greatest(0, _offset)
  loop
    return next public.mask_job_for_driver(j);
  end loop;
end $$;

create or replace function public.driver_open_job(_id uuid)
returns setof public.jobs
language plpgsql stable security definer set search_path to 'public'
as $$
declare j public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if not public.is_verified_driver(auth.uid()) then return; end if;
  select * into j from public.jobs
   where id = _id and status = 'open' and driver_id is null and customer_id <> auth.uid();
  if not found then return; end if;
  return next public.mask_job_for_driver(j);
end $$;

revoke all on function public.driver_open_jobs(integer, integer) from public, anon;
revoke all on function public.driver_open_job(uuid) from public, anon;
grant execute on function public.driver_open_jobs(integer, integer) to authenticated;
grant execute on function public.driver_open_job(uuid) to authenticated;

-- The job table: close the open-job window ---------------------------------------------------
alter policy "Jobs visibility" on public.jobs
  using (
    customer_id = auth.uid()
    or (driver_id = auth.uid() and status in ('accepted', 'in_progress', 'completed'))
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- tg_stamp_bid_capacity reads the job's quantity while a driver places a bid. It ran as the driver, so the
-- closed policy would have stopped every bid; it now runs as the owner (it still checks truck ownership
-- against new.driver_id, which bids_guard_insert has already tied to the caller).
alter function public.tg_stamp_bid_capacity() security definer;
revoke all on function public.tg_stamp_bid_capacity() from public, anon, authenticated;

-- driver_available_jobs: keep the original (renamed, not callable) and expose a masked wrapper ----
do $$ begin
  if to_regprocedure('public._driver_available_jobs_exact(integer, integer)') is null then
    alter function public.driver_available_jobs(integer, integer) rename to _driver_available_jobs_exact;
  end if;
  if to_regprocedure('public._find_next_loads_exact(uuid, uuid)') is null then
    alter function public.find_next_loads_for_driver(uuid, uuid) rename to _find_next_loads_exact;
  end if;
end $$;
revoke all on function public._driver_available_jobs_exact(integer, integer) from public, anon, authenticated;
revoke all on function public._find_next_loads_exact(uuid, uuid) from public, anon, authenticated;

create or replace function public.driver_available_jobs(_limit integer default 50, _offset integer default 0)
returns table(id uuid, material text, custom_material text, quantity_m3 numeric, budget numeric, delivery_address text,
              delivery_lat double precision, delivery_lng double precision, preferred_date date, notes text,
              created_at timestamptz, expires_at timestamptz, bid_count bigint, my_bid_id uuid, my_bid_price numeric,
              my_offer_id uuid, offer_expires_at timestamptz, commission_due numeric, can_afford boolean)
language sql stable security definer set search_path to 'public'
as $$
  select e.id, e.material, e.custom_material, e.quantity_m3, e.budget,
         public.coarse_place(e.delivery_address), public.coarse_coord(e.delivery_lat), public.coarse_coord(e.delivery_lng),
         e.preferred_date, public.redact_contacts(e.notes), e.created_at, e.expires_at, e.bid_count, e.my_bid_id,
         e.my_bid_price, e.my_offer_id, e.offer_expires_at, e.commission_due, e.can_afford
    from public._driver_available_jobs_exact(_limit, _offset) e
$$;
revoke all on function public.driver_available_jobs(integer, integer) from public, anon;
grant execute on function public.driver_available_jobs(integer, integer) to authenticated;

create or replace function public.find_next_loads_for_driver(_driver_id uuid, _current_job_id uuid)
returns table(job_id uuid, material public.material_category, quantity_m3 numeric, pickup_address text,
              pickup_lat double precision, pickup_lng double precision, delivery_address text,
              delivery_lat double precision, delivery_lng double precision, budget numeric, preferred_date date,
              repositioning_km numeric, next_load_km numeric, empty_km_saved numeric, capacity_tier text,
              capacity_trips integer, recommendation_tier text)
language sql stable security definer set search_path to 'public'
as $$
  select e.job_id, e.material, e.quantity_m3, e.pickup_address, e.pickup_lat, e.pickup_lng,
         public.coarse_place(e.delivery_address), public.coarse_coord(e.delivery_lat), public.coarse_coord(e.delivery_lng),
         e.budget, e.preferred_date, e.repositioning_km, e.next_load_km, e.empty_km_saved, e.capacity_tier,
         e.capacity_trips, e.recommendation_tier
    from public._find_next_loads_exact(_driver_id, _current_job_id) e
$$;
revoke all on function public.find_next_loads_for_driver(uuid, uuid) from public, anon;
grant execute on function public.find_next_loads_for_driver(uuid, uuid) to authenticated;

-- History: a cancelled job shows only the area and no customer name. pod_token is returned as null: the
-- public.pods table the old body joined does not exist in production (checked 04/11), so that join made every call fail.
-- ------------------------------------------------------------------------------------------------
create or replace function public.driver_job_history(_limit integer default 30, _offset integer default 0)
returns table(id uuid, status text, material text, custom_material text, quantity_m3 numeric, final_price numeric,
              commission numeric, net_earned numeric, delivery_address text, completed_at timestamptz,
              cancelled_at timestamptz, cancellation_reason text, cancelled_by_me boolean, customer_name text,
              pod_token text, total_count bigint)
language plpgsql stable security definer set search_path to 'public', 'extensions'
as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  return query
  select j.id, j.status::text, j.material::text, j.custom_material, j.quantity_m3, j.final_price, j.commission,
         coalesce(j.final_price,0) - coalesce(j.commission,0),
         case when j.status = 'completed' then j.delivery_address else public.coarse_place(j.delivery_address) end,
         j.completed_at, j.cancelled_at, j.cancellation_reason, (j.cancelled_by = auth.uid()),
         case when j.status = 'completed' then cp.full_name else null end,
         null::text, count(*) over ()
    from public.jobs j
    left join public.profiles cp on cp.id = j.customer_id
   where j.driver_id = auth.uid() and j.status in ('completed', 'cancelled')
   order by coalesce(j.completed_at, j.cancelled_at, j.updated_at) desc
   limit greatest(1, least(_limit, 100)) offset greatest(0, _offset);
end $$;

commit;
