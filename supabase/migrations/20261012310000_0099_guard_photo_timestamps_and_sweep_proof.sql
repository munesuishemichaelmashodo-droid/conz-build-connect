-- =============================================================================
-- 0099 — A driver could backdate the delivery-photo clock and trigger an instant
-- escrow auto-release (12/10/2026)
--
-- VERIFIED DEFECT (reproduced on the local stand-in, chain run as the driver only):
--   jobs_guard_direct_write stops a CUSTOMER from writing pickup_photo_taken_at /
--   delivery_photo_taken_at, but its DRIVER branch never checked them. The driver's
--   UPDATE policy on jobs therefore let the assigned driver run
--       update jobs set delivery_photo_taken_at = now() - interval '80 hours' ...
--   auto_release_escrow_payments() releases an escrow job once that timestamp is older
--   than 72 hours with no open dispute. So a driver who uploaded any delivery photo
--   could be paid out on the next sweep with NO customer delivery code and NO 72-hour
--   window for the customer to dispute (job completed, driver credited, commission
--   booked in the reproduction).
--
-- FIX (forward-only, small, idempotent)
--   1. New BEFORE UPDATE trigger jobs_guard_photo_times: those two timestamps may be
--      changed only by the database itself (jobs_stamp_photo_times, record_job_evidence,
--      other SECURITY DEFINER code) or by an admin. It is a separate trigger so the
--      large jobs_guard_direct_write function (whose production definition is not
--      byte-identical to git) is left untouched. Its name sorts before
--      jobs_photo_timestamps, so the legitimate stamping still happens afterwards.
--   2. auto_release_escrow_payments() additionally requires that the delivery photo is
--      backed by a real delivery evidence row from the job's driver (same match as
--      0096's job_has_delivery_evidence, written inline so this migration does not
--      depend on 0096, which production does not have yet).
--      Everything else in the function is unchanged.
--
-- Deploy order: independent of the app (no client code writes these columns).
-- No data is changed. Rollback: drop trigger jobs_guard_photo_times; restore the
-- previous auto_release_escrow_payments body (identical minus the evidence predicate).
-- =============================================================================

create or replace function public.jobs_guard_photo_times()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;                                   -- database-internal writes (stamp trigger, RPCs)
  end if;
  if new.pickup_photo_taken_at   is distinct from old.pickup_photo_taken_at
     or new.delivery_photo_taken_at is distinct from old.delivery_photo_taken_at then
    if auth.uid() is not null
       and (public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
      return new;
    end if;
    raise exception 'Photo timestamps are recorded by the system and cannot be edited.'
      using errcode = '42501';
  end if;
  return new;
end $fn$;

drop trigger if exists jobs_guard_photo_times on public.jobs;
create trigger jobs_guard_photo_times
  before update on public.jobs
  for each row execute function public.jobs_guard_photo_times();

create or replace function public.auto_release_escrow_payments()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT j.* FROM public.jobs j
    WHERE j.payment_method = 'escrow'
      AND j.status IN ('accepted', 'in_progress')
      AND j.delivery_photo_taken_at IS NOT NULL
      AND j.delivery_photo_taken_at < now() - interval '72 hours'
      AND EXISTS (                       -- inline (not 0096's helper) so 0099 stands alone on production
        SELECT 1 FROM public.job_evidence e
         WHERE e.job_id = j.id AND e.kind = 'delivery'
           AND e.storage_path = j.delivery_photo_url
           AND e.uploaded_by = j.driver_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.disputes d
        WHERE d.job_id = j.id AND d.status IN ('open', 'investigating')
      )
      AND EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.job_id = j.id AND p.type = 'escrow' AND p.status = 'paid'
      )
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.release_escrow_and_complete(_row.id, _row.driver_id);
      _cnt := _cnt + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Don't let one bad row abort the whole sweep — log and move on.
      RAISE WARNING 'auto_release_escrow_payments failed for job %: %', _row.id, SQLERRM;
    END;
  END LOOP;
  RETURN _cnt;
END $function$;

revoke all on function public.auto_release_escrow_payments() from public, anon, authenticated;
grant execute on function public.auto_release_escrow_payments() to service_role;
