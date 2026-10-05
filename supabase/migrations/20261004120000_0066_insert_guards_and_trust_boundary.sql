-- 0066 — Database trust boundary: BEFORE INSERT guards + least privilege.
--
-- Security reason (audit 04/10/2026): the existing guard triggers on jobs,
-- bids and driver_profiles fire BEFORE *UPDATE* only, while RLS also lets
-- clients INSERT (and for driver_profiles DELETE) the same rows. A client
-- can therefore set privileged columns at creation, or wipe+recreate a row,
-- bypassing the update guards entirely:
--   C2  driver self-verifies (driver_profiles INSERT/DELETE)
--   C3  driver forges a customer counter-offer (bids INSERT)
--   H1  customer fabricates completed jobs / manipulates ratings
--   H2  user lifts their own suspension (profiles UPDATE/INSERT)
--   H10 user opens disputes on arbitrary jobs (disputes INSERT)
--   H3  user skips withdrawal validation (wallet_withdrawal_requests INSERT)
--
-- Design: each guard early-returns unless current_user is 'authenticated'
-- or 'anon', so SECURITY DEFINER RPCs (run as the owner) and the service
-- role are unaffected — the app's server-side write paths keep working
-- exactly as before. Legitimate client writes that only set non-privileged
-- columns (posting a job, placing a bid, creating/updating one's own driver
-- profile with document URLs, editing name/phone) continue to work.
--
-- Idempotent / non-destructive: no data is deleted; triggers and policies
-- are dropped-if-exists then recreated. Safe to replay.

-- ---------------------------------------------------------------------------
-- 1. driver_profiles — block privileged columns at INSERT; remove DELETE.
--    (UPDATE is already guarded by trg_driver_profiles_guard_direct_write.)
-- ---------------------------------------------------------------------------
create or replace function public.driver_profiles_guard_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Not authorised to create this driver profile.' using errcode = '42501';
  end if;
  -- Verification, level, stats and commission-exemption state can never be
  -- self-set — only an admin workflow (admin_set_driver_verification) or the
  -- app's own server code may change them.
  new.verification_status := 'pending';
  new.verification_notes  := null;
  new.verified_at         := null;
  new.reverify_due_at     := null;
  new.level               := 'bronze';
  new.rating_avg          := 0;
  new.rating_count        := 0;
  new.jobs_completed      := 0;
  new.first_job_free_used := false;
  new.withdrawal_pin_hash := null;
  return new;
end $$;

drop trigger if exists trg_driver_profiles_guard_insert on public.driver_profiles;
create trigger trg_driver_profiles_guard_insert
  before insert on public.driver_profiles
  for each row execute function public.driver_profiles_guard_insert();

-- Deleting + recreating the row was the C2 bypass. Nothing in the app
-- deletes a driver_profiles row from the client (account deletion scrubs it
-- via the service role). Remove the grant so the policy can never allow it.
revoke delete on public.driver_profiles from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. bids — block status / counter-offer forgery at INSERT.
--    (UPDATE is already guarded by trg_bids_guard_direct_write.)
-- ---------------------------------------------------------------------------
create or replace function public.bids_guard_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null or new.driver_id <> auth.uid() then
    raise exception 'Not authorised to create this bid.' using errcode = '42501';
  end if;
  -- A customer counter-offer can only ever be created by the customer via
  -- counter_bid(); a driver can never manufacture one at bid creation.
  new.status                 := 'pending';
  new.counter_status         := 'none';
  new.customer_counter_price := null;
  new.created_at             := now();
  return new;
end $$;

drop trigger if exists trg_bids_guard_insert_fields on public.bids;
create trigger trg_bids_guard_insert_fields
  before insert on public.bids
  for each row execute function public.bids_guard_insert();

-- ---------------------------------------------------------------------------
-- 3. jobs — block privileged / outcome columns at INSERT, and stop
--    payment_method being changed after creation (H5).
-- ---------------------------------------------------------------------------
create or replace function public.jobs_guard_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null or new.customer_id <> auth.uid() then
    raise exception 'Not authorised to create this job.' using errcode = '42501';
  end if;
  -- A new job is always an open, unassigned request. Everything below is set
  -- only by the app's job actions (accept / start / complete / cancel).
  new.status                    := 'open';
  new.driver_id                 := null;
  new.accepted_bid_id           := null;
  new.final_price               := null;
  new.commission                := null;
  new.held_commission           := null;
  new.completed_at              := null;
  new.cancelled_at              := null;
  new.cancelled_by              := null;
  new.cancellation_stage        := null;
  new.cancellation_reason       := null;
  new.delivery_pin              := null;
  new.pickup_photo_url          := null;
  new.delivery_photo_url        := null;
  new.pickup_photo_taken_at     := null;
  new.delivery_photo_taken_at   := null;
  new.delivered_quantity_m3     := null;
  new.receiver_name             := null;
  new.driver_arrived_pickup_at  := null;
  new.driver_arrived_dropoff_at := null;
  new.created_at                := now();
  new.tracking_token            := gen_random_uuid();
  return new;
end $$;

drop trigger if exists trg_jobs_guard_insert on public.jobs;
create trigger trg_jobs_guard_insert
  before insert on public.jobs
  for each row execute function public.jobs_guard_insert();

-- Extend the UPDATE guard so payment_method is immutable via a direct client
-- write (it is chosen at creation; changing it after escrow is funded was
-- the H5 "strand the escrow" path). Admins and server code still bypass.
create or replace function public.jobs_guard_direct_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _is_admin  boolean;
  _is_driver boolean;
  _is_cust   boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this job.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then return new; end if;

  _is_driver := (old.driver_id   = auth.uid());
  _is_cust   := (old.customer_id = auth.uid());

  if new.status                is distinct from old.status
     or new.commission         is distinct from old.commission
     or new.final_price        is distinct from old.final_price
     or new.budget             is distinct from old.budget
     or new.driver_id          is distinct from old.driver_id
     or new.customer_id        is distinct from old.customer_id
     or new.accepted_bid_id    is distinct from old.accepted_bid_id
     or new.tracking_token     is distinct from old.tracking_token
     or new.held_commission    is distinct from old.held_commission
     or new.payment_method     is distinct from old.payment_method
     or new.delivery_pin       is distinct from old.delivery_pin
     or new.cancelled_at       is distinct from old.cancelled_at
     or new.cancelled_by       is distinct from old.cancelled_by
     or new.cancellation_stage is distinct from old.cancellation_stage
     or new.cancellation_reason is distinct from old.cancellation_reason
     or new.completed_at       is distinct from old.completed_at
     or new.created_at         is distinct from old.created_at
  then
    raise exception
      'This field can only be changed through the app''s job actions (accept / complete / cancel).'
      using errcode = '42501';
  end if;

  if _is_driver then
    if new.material            is distinct from old.material
       or new.custom_material  is distinct from old.custom_material
       or new.quantity_m3      is distinct from old.quantity_m3
       or new.delivery_address is distinct from old.delivery_address
       or new.dropoff_address  is distinct from old.dropoff_address
       or new.delivery_lat     is distinct from old.delivery_lat
       or new.delivery_lng     is distinct from old.delivery_lng
       or new.dropoff_lat      is distinct from old.dropoff_lat
       or new.dropoff_lng      is distinct from old.dropoff_lng
       or new.preferred_date   is distinct from old.preferred_date
       or new.expires_at       is distinct from old.expires_at
       or new.notes            is distinct from old.notes
    then
      raise exception 'Drivers may only record delivery progress, not change the order.'
        using errcode = '42501';
    end if;

    if old.pickup_photo_url is not null
       and new.pickup_photo_url is distinct from old.pickup_photo_url then
      raise exception 'The pickup photo has already been recorded and cannot be replaced.'
        using errcode = '42501';
    end if;
    if old.delivery_photo_url is not null
       and new.delivery_photo_url is distinct from old.delivery_photo_url then
      raise exception 'The delivery photo has already been recorded and cannot be replaced.'
        using errcode = '42501';
    end if;

    if old.pickup_photo_url is null
       and new.pickup_photo_url is not null
       and not exists (
         select 1 from public.job_evidence e
          where e.job_id = old.id and e.kind = 'pickup'
            and e.storage_path = new.pickup_photo_url
            and e.uploaded_by = auth.uid()
       )
    then
      raise exception 'Pickup photo must be uploaded through the evidence system first.'
        using errcode = '42501';
    end if;

    if old.delivery_photo_url is null
       and new.delivery_photo_url is not null
       and not exists (
         select 1 from public.job_evidence e
          where e.job_id = old.id and e.kind = 'delivery'
            and e.storage_path = new.delivery_photo_url
            and e.uploaded_by = auth.uid()
       )
    then
      raise exception 'Delivery photo must be uploaded through the evidence system first.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  if _is_cust then
    if new.pickup_lat        is distinct from old.pickup_lat
       or new.pickup_lng     is distinct from old.pickup_lng
       or new.pickup_address is distinct from old.pickup_address
    then
      raise exception 'Pickup location is recorded by the driver.' using errcode = '42501';
    end if;

    if new.pickup_photo_url          is distinct from old.pickup_photo_url
       or new.delivery_photo_url     is distinct from old.delivery_photo_url
       or new.pickup_photo_taken_at  is distinct from old.pickup_photo_taken_at
       or new.delivery_photo_taken_at is distinct from old.delivery_photo_taken_at
       or new.delivered_quantity_m3  is distinct from old.delivered_quantity_m3
       or new.receiver_name          is distinct from old.receiver_name
    then
      raise exception 'Delivery evidence is recorded by the driver.' using errcode = '42501';
    end if;

    if old.status <> 'open' then
      if new.material            is distinct from old.material
         or new.custom_material  is distinct from old.custom_material
         or new.quantity_m3      is distinct from old.quantity_m3
         or new.delivery_address is distinct from old.delivery_address
         or new.dropoff_address  is distinct from old.dropoff_address
         or new.delivery_lat     is distinct from old.delivery_lat
         or new.delivery_lng     is distinct from old.delivery_lng
         or new.dropoff_lat      is distinct from old.dropoff_lat
         or new.dropoff_lng      is distinct from old.dropoff_lng
         or new.preferred_date   is distinct from old.preferred_date
      then
        raise exception 'This job has been accepted — cancel it to change the order.'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  raise exception 'Not authorised to update this job.' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- 4. profiles — authorization-sensitive fields are server/admin-only (H2).
-- ---------------------------------------------------------------------------
create or replace function public.profiles_guard_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null or new.id <> auth.uid() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  new.status                := 'active';
  new.restricted_until      := null;
  new.restriction_reason    := null;
  new.cancellation_strikes  := 0;
  new.customer_rating_avg   := null;
  new.customer_rating_count := 0;
  new.deleted_at            := null;
  return new;
end $$;

drop trigger if exists trg_profiles_guard_insert on public.profiles;
create trigger trg_profiles_guard_insert
  before insert on public.profiles
  for each row execute function public.profiles_guard_insert();

create or replace function public.profiles_guard_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  -- Clients may edit only presentational / self-service fields. Account
  -- status, restrictions, strikes, ratings, deletion, referral code, email
  -- and identity are changed exclusively by admin RPCs or server code.
  if new.id <> old.id
     or new.status               is distinct from old.status
     or new.restricted_until     is distinct from old.restricted_until
     or new.restriction_reason   is distinct from old.restriction_reason
     or new.cancellation_strikes is distinct from old.cancellation_strikes
     or new.customer_rating_avg  is distinct from old.customer_rating_avg
     or new.customer_rating_count is distinct from old.customer_rating_count
     or new.deleted_at           is distinct from old.deleted_at
     or new.referral_code        is distinct from old.referral_code
     or new.email                is distinct from old.email
     or new.created_at           is distinct from old.created_at
  then
    raise exception 'This profile field can only be changed by Con Z.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard_update on public.profiles;
create trigger trg_profiles_guard_update
  before update on public.profiles
  for each row execute function public.profiles_guard_update();

-- ---------------------------------------------------------------------------
-- 5. disputes — only raise_dispute() (SECURITY DEFINER) may create them.
-- ---------------------------------------------------------------------------
revoke insert on public.disputes from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. withdrawal / top-up requests — only the validating RPCs may create them
--    (request_withdrawal checks PIN, balance, limits; request_topup checks
--    amount/method). Owner SELECT and owner cancel (UPDATE) are unchanged.
-- ---------------------------------------------------------------------------
revoke insert on public.wallet_withdrawal_requests from authenticated, anon;
revoke insert on public.wallet_topup_requests       from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. ratings — a customer may only rate the driver who actually did the job.
-- ---------------------------------------------------------------------------
drop policy if exists "Customers rate own completed jobs" on public.ratings;
create policy "Customers rate own completed jobs"
  on public.ratings for insert to authenticated
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.jobs j
       where j.id = ratings.job_id
         and j.customer_id = auth.uid()
         and j.driver_id = ratings.driver_id
         and j.status = 'completed'::job_status
    )
  );
