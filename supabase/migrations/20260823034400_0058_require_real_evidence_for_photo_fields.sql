-- 0058: close the evidence-forgery gap in jobs.pickup_photo_url / delivery_photo_url
--
-- jobs_guard_direct_write() correctly stopped a driver from REPLACING a
-- pickup/delivery photo once one was already set (append-only), but did
-- nothing to validate the FIRST value a driver's client sent. A driver
-- could satisfy start_trip's "pickup photo required" gate by writing an
-- arbitrary string directly to jobs.pickup_photo_url with no real Storage
-- upload and no job_evidence row behind it at all.
--
-- Fix: on a driver's first-ever set of pickup_photo_url / delivery_photo_url,
-- require that value to match an existing job_evidence row for the same
-- job, kind, and uploader (i.e. it must have gone through
-- record_job_evidence() first, the same path uploadJobEvidence() uses).

create or replace function public.jobs_guard_direct_write()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
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

    -- evidence is append-only: once set, a photo cannot be
    -- swapped or deleted from the client
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

    -- the FIRST set of pickup/delivery photo url must correspond to a
    -- real, already-recorded job_evidence row for this job/kind/driver —
    -- a client can no longer satisfy start_trip's evidence gate by
    -- writing an arbitrary string with no real upload behind it
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
end
$function$;
