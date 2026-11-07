-- Undo for 0143_scheduled_job_expiry.
-- Restores expire_stale_accepted_jobs to the exact production definition read on 07/11/2026
-- (whitespace-stripped body md5 7d2fc566c5322bdb7755a5bb37ec491f) and removes the insert trigger.
-- The DROP statements must run in the Supabase SQL editor (the MCP tool hangs on DROP).

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

drop trigger if exists trg_jobs_scheduled_expiry on public.jobs;
drop function if exists public.jobs_set_scheduled_expiry();
