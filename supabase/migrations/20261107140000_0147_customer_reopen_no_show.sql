-- 0147 — the customer can choose to reopen a job that was cancelled because the driver never showed up.
-- Today the 24 h sweep (expire_stale_accepted_jobs) cancels the job and tells the customer to "post it again".
-- The sweep itself is NOT changed: the cancellation, the driver's strike and the commission release stay
-- exactly as they are. This adds an explicit, customer-controlled way back, nothing automatic.
-- WHEN ALLOWED (all must hold): caller is the job's customer; status cancelled; payment_method direct
-- (escrow jobs have a refund flow); cancelled by the sweep (its exact reason AND cancelled_by null: the sweep
-- never sets it, cancel_job always does, so a hand-cancelled job cannot imitate a no-show); within 7 days; the driver never
-- arrived at pickup, no pickup photo, no dispute on the job.
-- WHAT IT DOES: job back to open with a 24 h window; driver, accepted bid, final price, delivery code and
-- cancellation fields cleared; the no-show driver cannot be offered it again; a dispatch wave starts.
-- FINANCIAL: no financial function is called or modified. The reserve was already released by the sweep
-- (jobs.held_commission is null); the next acceptance holds a fresh one through the unchanged accept path.
-- Undo: supabase/rollbacks/20261107140000_0147_rollback.sql. NOT APPLIED to any hosted project.

create or replace function public.customer_reopen_no_show_job(_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job    public.jobs;
  _driver uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can reopen this job.' using errcode = '42501';
  end if;
  if _job.status <> 'cancelled'
     or _job.payment_method <> 'direct'
     or _job.cancellation_reason is distinct from 'Driver did not start pickup within 24 hours of accepting'
     or _job.cancelled_by is not null
     or _job.cancelled_at is null or _job.cancelled_at < now() - interval '7 days'
     or _job.driver_arrived_pickup_at is not null
     or _job.pickup_photo_url is not null
     or _job.pickup_photo_taken_at is not null
     or exists (select 1 from public.disputes d where d.job_id = _job_id) then
    raise exception 'This job can no longer be reopened.' using errcode = '22023';
  end if;
  _driver := _job.driver_id;

  if _job.accepted_bid_id is not null then
    update public.bids set status = 'withdrawn' where id = _job.accepted_bid_id and status = 'accepted';
  end if;

  update public.jobs
     set status = 'open', driver_id = null, accepted_bid_id = null, final_price = null,
         held_commission = null, delivery_pin = null,
         driver_arrived_pickup_at = null, driver_arrived_dropoff_at = null,
         cancellation_reason = null, cancellation_stage = null, cancelled_at = null, cancelled_by = null,
         expires_at = now() + interval '24 hours'
   where id = _job_id
  returning * into _job;

  delete from public.job_delivery_pins where job_id = _job_id;

  -- Fresh dispatch: clear old offers, but never offer the no-show driver again.
  delete from public.job_dispatch_offers where job_id = _job_id;
  if _driver is not null then
    insert into public.job_dispatch_offers (job_id, driver_id, wave, status, responded_at)
    values (_job_id, _driver, 0, 'rejected', now())
    on conflict (job_id, driver_id) do nothing;
  end if;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.customer_id, 'job_reopened', 'Your request is open again',
          'Nearby drivers have been alerted. You can cancel the request from the job page at any time.', _job_id);

  perform public.create_dispatch_wave(_job_id, 5);
  return _job;
end
$$;

revoke all on function public.customer_reopen_no_show_job(uuid) from public, anon;
grant execute on function public.customer_reopen_no_show_job(uuid) to authenticated, service_role;
