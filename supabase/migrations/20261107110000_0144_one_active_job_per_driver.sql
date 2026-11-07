-- 0144: a driver cannot hold two accepted / in-progress jobs at the same time (Harare pilot rule).
--
-- GAP (read from the live definitions, 07/11/2026): the dispatch path (accept_dispatch_offer) only offers
-- jobs to drivers with no active job (eligible_dispatch_drivers), but the bid path (accept_bid and
-- accept_counter) never checked. Two customers could accept the same driver within minutes and leave
-- one of them with a driver who cannot arrive. Production today has 2 drivers holding more than one
-- active job (aggregate count only, no data read).
--
-- FIX: one BEFORE UPDATE trigger on jobs. Every acceptance path ends in the same UPDATE
-- (status -> 'accepted' with a driver_id), so one trigger gives all of them the same rule.
--   * Only the TRANSITION into "accepted for this driver" is checked, so jobs that are already running,
--     including any existing double bookings, keep working and can finish.
--   * pg_advisory_xact_lock(driver) serialises concurrent acceptances of the same driver. Row locks are
--     per job, so without it two customers accepting two different jobs for one driver at the same
--     moment would both pass the check.
--   * Completed and cancelled jobs do not count.
--   * The error text starts with DRIVER_BUSY so the app can show a plain message.
--
-- No financial function is touched; the whole acceptance (including the commission reserve) rolls back.
-- DEPLOY ORDER: database only. The app change (friendly message) is optional and independent.
-- ROLLBACK: supabase/rollbacks/20261107110000_0144_rollback.sql (its DROP runs in the SQL editor).
-- NOT APPLIED to any hosted project.

create or replace function public.tg_one_active_job_per_driver()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'accepted'
     and new.driver_id is not null
     and (old.status is distinct from 'accepted' or old.driver_id is distinct from new.driver_id)
  then
    -- One acceptance per driver at a time, even across different jobs.
    perform pg_advisory_xact_lock(hashtextextended('conz:driver_active_job:' || new.driver_id::text, 0));

    if exists (
      select 1
        from public.jobs j
       where j.driver_id = new.driver_id
         and j.id <> new.id
         and j.status in ('accepted', 'in_progress')
    ) then
      raise exception 'DRIVER_BUSY: this driver is already on another job. Choose another offer, or wait until they finish their current job.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.tg_one_active_job_per_driver() from public, anon, authenticated;
grant execute on function public.tg_one_active_job_per_driver() to service_role;

create or replace trigger trg_jobs_one_active_per_driver
  before update of status, driver_id on public.jobs
  for each row execute function public.tg_one_active_job_per_driver();
