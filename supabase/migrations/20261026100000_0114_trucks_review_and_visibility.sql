-- -----------------------------------------------------------------------------
-- 0114: truck changes need re-review; only approved drivers can be given a job;
-- trucks are visible only where needed.
--
-- PREPARED, NOT APPLIED. Needs the owner's approval before production. Contains
-- DROP POLICY (the Supabase MCP tool hangs on DROP): apply in the SQL editor.
-- Undo: supabase/rollbacks/20261026100000_0114_rollback.sql.
--
-- Why (read-only checks on production, 25/10/2026):
--   S-1  "Drivers manage own trucks" lets a verified driver change a truck's
--        registration, capacity or photo, or add a truck, with no trigger. Capacity
--        is copied onto bids (tg_stamp_bid_capacity) and used for dispatch
--        (eligible_dispatch_drivers), so unreviewed details affect matching.
--   S-2  "Trucks readable by authenticated" (using true): any signed-in user can list
--        every truck's registration and capacity.
--   S-8  accept_bid / accept_counter / accept_dispatch_offer never re-check that the
--        driver is still approved, so an offer from a driver who was sent back to
--        review, or whose re-verification is overdue, could still be accepted.
--
-- What changes:
--   1. tg_truck_change_needs_review (after insert/update on trucks): when a driver
--      (not an admin, not the service role) adds a truck or changes its registration,
--      capacity, photo or owner while verified, their status goes back to 'pending'
--      with a note, their pending offers are withdrawn, and admins get a
--      'truck_review' notification. Unchanged saves and admin corrections do nothing.
--      Jobs the driver already has are not touched (in-progress actions don't depend
--      on verification), so a delivery under way can finish.
--   2. tg_jobs_driver_must_be_verified (before update of driver_id on jobs): a job can
--      only be given to a driver who passes is_verified_driver (driver role, verified,
--      re-verification not overdue). One check covers all three acceptance paths and
--      admin reassignment by any signed-in user. Removing a driver (driver_id -> null)
--      and service-role/cron writes (no auth.uid()) are unaffected.
--   3. Trucks visibility: drop "Trucks readable by authenticated"; add admin read, and
--      customer read only for trucks used in offers on the customer's own jobs (what
--      the job page shows). Drivers keep their own trucks ("Drivers manage own
--      trucks"). Security-definer functions (dispatch, next loads) are unaffected.
-- -----------------------------------------------------------------------------

begin;

-- 1. Re-review after a material truck change -----------------------------------
create or replace function public.tg_truck_change_needs_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
  _what text;
begin
  -- Service role, migrations and admins: no automatic re-review.
  if _uid is null then return new; end if;
  if public.has_role(_uid, 'admin'::public.app_role) or public.has_role(_uid, 'super_admin'::public.app_role) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.registration is not distinct from old.registration
       and new.capacity_m3 is not distinct from old.capacity_m3
       and new.photo_url is not distinct from old.photo_url
       and new.driver_id is not distinct from old.driver_id then
      return new;
    end if;
    _what := 'Truck details changed';
  else
    _what := 'New truck added';
  end if;

  update public.driver_profiles
     set verification_status = 'pending',
         verification_notes = _what || ' (' || coalesce(new.registration, 'no registration')
                              || '). Con Z needs to check it before you can take more jobs.'
   where user_id = new.driver_id
     and verification_status = 'verified';

  if found then
    update public.bids set status = 'withdrawn'
     where driver_id = new.driver_id and status = 'pending';
    begin
      insert into public.notifications (user_id, type, title, body)
      select distinct ur.user_id, 'truck_review', 'Truck needs review',
             _what || ' (' || coalesce(new.registration, 'no registration') || '). The driver is back in review.'
        from public.user_roles ur where ur.role in ('admin', 'super_admin');
    exception when others then
      raise warning 'truck review alert failed: %', sqlerrm;  -- never block the save
    end;
  end if;
  return new;
end $$;
revoke all on function public.tg_truck_change_needs_review() from public, anon, authenticated;

create or replace trigger trg_truck_change_needs_review
  after insert or update on public.trucks
  for each row execute function public.tg_truck_change_needs_review();

-- 2. Only approved drivers can be given a job -----------------------------------
create or replace function public.tg_jobs_driver_must_be_verified()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Applies to every signed-in caller (customers, drivers, admins), including through
  -- the security-definer acceptance functions. The service role, cron and migrations
  -- (no auth.uid()) are not limited.
  if auth.uid() is not null
     and new.driver_id is not null
     and new.driver_id is distinct from old.driver_id
     and not public.is_verified_driver(new.driver_id) then
    raise exception 'This driver is not approved to take jobs right now.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_jobs_driver_must_be_verified() from public, anon, authenticated;

create or replace trigger trg_jobs_driver_must_be_verified
  before update of driver_id on public.jobs
  for each row execute function public.tg_jobs_driver_must_be_verified();

-- 3. Trucks visibility ------------------------------------------------------------
drop policy if exists "Trucks readable by authenticated" on public.trucks;

drop policy if exists "Admins read trucks" on public.trucks;
create policy "Admins read trucks" on public.trucks
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role)
         or public.has_role(auth.uid(), 'super_admin'::public.app_role));

drop policy if exists "Customers read trucks offered on their jobs" on public.trucks;
create policy "Customers read trucks offered on their jobs" on public.trucks
  for select to authenticated
  using (exists (
    select 1
      from public.bids b
      join public.jobs j on j.id = b.job_id
     where b.truck_id = trucks.id
       and j.customer_id = auth.uid()
  ));

commit;
