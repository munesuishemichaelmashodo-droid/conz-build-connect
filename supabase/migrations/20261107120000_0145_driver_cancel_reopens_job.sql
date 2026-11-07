-- 0145: when the assigned driver cancels an accepted job before pickup, the job reopens for other drivers.
--
-- POLICY (owner, 07/11/2026): a driver cancelling after acceptance should generally return the job to
-- the marketplace instead of killing the customer's request, provided the delivery has not progressed
-- to a stage that needs dispute handling, the customer still wants it, and existing rules allow it.
--
-- WHEN IT REOPENS (all must hold): the caller is the assigned driver (and not acting as admin); status
-- is 'accepted' (not in progress); the load has not been collected (no pickup photo); payment_method is
-- 'direct'. Everything else keeps the existing cancel_job behaviour exactly: customer cancels, admin
-- cancels, escrow jobs (they have a refund flow), loaded jobs, in-progress jobs (dispute).
--
-- WHAT IT DOES (reopen_job_after_driver_cancel):
--   * releases the commission reserve with the EXISTING release_job_commission (unchanged). That
--     function sets jobs.held_commission to NULL, and hold_job_commission only skips when it is NOT
--     null, so the next driver gets a fresh reserve. No financial function is modified.
--   * records the driver's cancellation (cancellation_events, post_acceptance), as cancel_job already did
--   * marks the driver's accepted offer 'withdrawn'; offers that lost when this driver was chosen come
--     back to 'pending' with a fresh 30-minute clock (unless that driver is now busy on another job);
--     those drivers are notified, as is the customer
--   * clears the driver, final price and delivery code; extends the bidding window to at least 24 h
--   * excludes the cancelling driver from re-dispatch, drops stale 'superseded' dispatch offers so
--     eligible drivers can be offered the job again, and starts a new dispatch wave
--
-- cancel_job below is the live body (md5, whitespace stripped, 403695f5049358f1a29bd8c74f9fa6cb) plus one
-- early branch. Same signature, attributes and grants.
--
-- DEPLOY ORDER: database first or with the app; the app change only adds a driver button.
-- ROLLBACK: supabase/rollbacks/20261107120000_0145_rollback.sql (its DROP runs in the SQL editor).
-- NOT APPLIED to any hosted project.

create or replace function public.reopen_job_after_driver_cancel(_job_id uuid, _reason text)
returns public.jobs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job    public.jobs;
  _driver uuid;
  _bid    uuid;
  _clean  text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.driver_id is distinct from auth.uid() then
    raise exception 'Only the assigned driver can release this job.' using errcode = '42501';
  end if;
  if _job.status <> 'accepted' or _job.payment_method <> 'direct' or _job.pickup_photo_url is not null then
    raise exception 'This job can no longer be reopened.' using errcode = '22023';
  end if;
  _driver := _job.driver_id;
  _bid    := _job.accepted_bid_id;

  -- Existing financial function, unchanged: releases the reserve and clears jobs.held_commission.
  perform public.release_job_commission(_job_id);

  update public.bids set status = 'withdrawn' where id = _bid;

  -- Offers that lost when this driver was chosen come back, unless that driver is busy now.
  with revived as (
    update public.bids b
       set status = 'pending', counter_status = 'none', customer_counter_price = null,
           expires_at = now() + interval '30 minutes'
     where b.job_id = _job_id and b.status = 'rejected' and b.driver_id <> _driver
       and not exists (select 1 from public.jobs j2
                        where j2.driver_id = b.driver_id and j2.status in ('accepted', 'in_progress'))
    returning b.driver_id
  )
  insert into public.notifications (user_id, type, title, body, job_id)
  select r.driver_id, 'offer_reopened', 'A job you offered on is open again',
         'The customer''s driver cancelled, so your earlier offer is live again for 30 minutes. Update it or withdraw it from the job page.',
         _job_id
    from revived r;

  update public.jobs
     set status = 'open', driver_id = null, accepted_bid_id = null, final_price = null,
         held_commission = null, delivery_pin = null,
         driver_arrived_pickup_at = null, driver_arrived_dropoff_at = null,
         expires_at = greatest(coalesce(expires_at, now()), now() + interval '24 hours')
   where id = _job_id
  returning * into _job;

  -- A fresh delivery code is generated when the next driver is accepted.
  delete from public.job_delivery_pins where job_id = _job_id;

  -- Let eligible drivers be offered the job again, but never the one who cancelled.
  delete from public.job_dispatch_offers where job_id = _job_id and status = 'superseded';
  insert into public.job_dispatch_offers (job_id, driver_id, wave, status, responded_at)
  values (_job_id, _driver, 0, 'rejected', now())
  on conflict (job_id, driver_id) do nothing;

  insert into public.cancellation_events (user_id, job_id, role, stage, reason)
  values (_driver, _job_id, 'driver', 'post_acceptance', coalesce(_clean, 'Driver released the job'));

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.customer_id, 'job_reopened', 'Your driver cancelled — your request is open again',
          'Nearby drivers have been alerted and earlier offers are back. You can also cancel the request from the job page.',
          _job_id);

  perform public.create_dispatch_wave(_job_id, 5);

  return _job;
end
$$;

revoke all on function public.reopen_job_after_driver_cancel(uuid, text) from public, anon, authenticated;
grant execute on function public.reopen_job_after_driver_cancel(uuid, text) to service_role;

create or replace function public.cancel_job(_job_id uuid, _reason text default null)
returns public.jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
  _prev_status text; _admin_acting boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if not (_is_admin or auth.uid() = _job.customer_id or auth.uid() = _job.driver_id) then
    raise exception 'Not authorised to cancel this job';
  end if;
  if _job.status in ('completed','cancelled') then
    raise exception 'Job already % and cannot be cancelled', _job.status;
  end if;
  if _job.status = 'in_progress' and not _is_admin then
    raise exception 'Job is in progress — raise a dispute instead of cancelling';
  end if;

  -- 0145: the assigned driver cancelling a direct-pay job before pickup reopens it for other drivers.
  if auth.uid() = _job.driver_id and not _is_admin
     and _job.status = 'accepted' and _job.payment_method = 'direct' and _job.pickup_photo_url is null
  then
    return public.reopen_job_after_driver_cancel(_job_id, _reason);
  end if;

  _admin_acting := _is_admin and auth.uid() is distinct from _job.customer_id
                             and auth.uid() is distinct from _job.driver_id;
  if _admin_acting and length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'A reason of at least 5 characters is required to cancel as an admin';
  end if;
  _prev_status := _job.status::text;

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  perform public.release_job_commission(_job_id);

  perform public.escrow_refund_due_for_job(_job_id, 'job_cancelled');

  update public.jobs
     set status = 'cancelled', cancellation_reason = _reason,
         cancellation_stage = _stage, cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = _job_id
  returning * into _job;

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job_id and status = 'pending';

  if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
    perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);
  end if;

  if _stage <> 'pre_acceptance' and auth.uid() = _job.driver_id then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_job.driver_id, _job_id, 'driver', _stage, _reason);
  end if;

  if _admin_acting then
    perform public.log_admin_action(
      _action      => 'job_cancelled_by_admin',
      _meta        => jsonb_build_object('job_id', _job_id, 'stage', _stage, 'previous_status', _prev_status),
      _reason      => btrim(_reason),
      _target_id   => _job_id,
      _target_user => _job.customer_id);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'), _job_id);
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'), _job_id);
  end if;

  return _job;
end
$$;

revoke all on function public.cancel_job(uuid, text) from public, anon;
grant execute on function public.cancel_job(uuid, text) to authenticated, service_role;
