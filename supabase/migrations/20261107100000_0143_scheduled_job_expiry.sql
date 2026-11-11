-- 0143: bookings for a later date are not cancelled early.
--
-- DEFECT (found by reading the live definitions, 07/11/2026; no production data was read or changed):
--   The booking form has a "Preferred date" field with no limit, but two expiries ignore it:
--   * `jobs.expires_at` defaults to now() + 48 h. After that nobody can bid (tg_guard_bid_insert) and
--     expire_stale_open_jobs cancels the job, whatever date the customer chose.
--   * expire_stale_accepted_jobs cancels any accepted job with no pickup photo 24 h after the last
--     update. A job accepted today for delivery tomorrow afternoon is cancelled tomorrow morning,
--     the customer is told "Driver did not show up", and the driver gets a cancellation strike
--     (cancellation_events) for a trip that was not due yet.
--
-- FIX (small, no financial logic touched):
--   1. expire_stale_accepted_jobs: identical to the live body except one extra condition, so a job
--      is only swept once its preferred date (Harare time) has passed. Release of the held commission,
--      escrow refunds, strikes and notifications are unchanged.
--   2. New BEFORE INSERT trigger jobs_set_scheduled_expiry on jobs, for client inserts only: the
--      bidding window is the later of 48 h from now and the end of the preferred date (the date
--      counts for at most 30 days ahead). A client can no longer choose its own expires_at either.
--
-- DEPLOY ORDER: database only, no app change needed. Apply with the statement bodies (no DROP).
-- ROLLBACK: supabase/rollbacks/20261107100000_0143_rollback.sql (its DROP must run in the SQL editor).
-- NOT APPLIED to any hosted project.

create or replace function public.expire_stale_accepted_jobs()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT * FROM public.jobs
    WHERE status = 'accepted'
      AND pickup_photo_taken_at IS NULL
      AND updated_at < now() - interval '24 hours'
      -- 0143: a booking for a later date is not overdue until that date has passed (Harare time).
      AND (preferred_date IS NULL OR preferred_date < (now() AT TIME ZONE 'Africa/Harare')::date)
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.release_job_commission(_row.id);

    -- F2: escrow already paid for a job the driver never started is refunded.
    PERFORM public.escrow_refund_due_for_job(_row.id, 'job_expired');

    UPDATE public.jobs
       SET status = 'cancelled',
           cancellation_reason = 'Driver did not start pickup within 24 hours of accepting',
           cancellation_stage = 'post_acceptance',
           cancelled_at = now()
     WHERE id = _row.id;

    IF _row.driver_id IS NOT NULL THEN
      INSERT INTO public.cancellation_events(user_id, job_id, role, stage, reason)
      VALUES (_row.driver_id, _row.id, 'driver', 'post_acceptance', 'auto-expired: no pickup within 24h');

      INSERT INTO public.notifications(user_id, type, title, body, job_id)
      VALUES (_row.driver_id, 'job_cancelled', 'Job auto-cancelled',
              'You accepted this job but did not start pickup within 24 hours, so it was automatically cancelled.',
              _row.id);
    END IF;

    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (_row.customer_id, 'job_expired', 'Driver did not show up',
            'Your driver did not start pickup within 24 hours. This job was cancelled — you can post it again to reach other drivers.',
            _row.id);

    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END
$$;

revoke all on function public.expire_stale_accepted_jobs() from public, anon, authenticated;
grant execute on function public.expire_stale_accepted_jobs() to service_role;

create or replace function public.jobs_set_scheduled_expiry()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare _day date;
begin
  -- Only client inserts: server-side paths (service role, tests) keep whatever expiry they set.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- least() ignores NULL, so a missing date must be handled explicitly or it would become "30 days".
  _day := case
            when new.preferred_date is null then null
            else least(new.preferred_date, (now() at time zone 'Africa/Harare')::date + 30)
          end;

  -- greatest() ignores NULL, so a booking with no date keeps the normal 48 hours.
  new.expires_at := greatest(
    now() + interval '48 hours',
    case when _day is null then null else ((_day + 1)::timestamp at time zone 'Africa/Harare') end
  );
  return new;
end
$$;

revoke all on function public.jobs_set_scheduled_expiry() from public, anon, authenticated;
grant execute on function public.jobs_set_scheduled_expiry() to service_role;

create or replace trigger trg_jobs_scheduled_expiry
  before insert on public.jobs
  for each row execute function public.jobs_set_scheduled_expiry();
