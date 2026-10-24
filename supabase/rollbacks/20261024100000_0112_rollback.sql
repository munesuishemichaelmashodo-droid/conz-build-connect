-- Undo 0112_pickup_check_route_trail. 0112 only ADDS objects (two tables, four
-- functions, two triggers, one cron job); nothing existing was changed, so undoing it
-- means removing them. This deletes the recorded pickup checks and route points.
-- Note: the Supabase MCP tool hangs on DROP; run this in the Supabase SQL editor.
begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'prune-job-route-points') then
    perform cron.unschedule('prune-job-route-points');
  end if;
end $$;
drop trigger if exists trg_record_route_point on public.driver_locations;
drop trigger if exists trg_pickup_check on public.job_evidence;
drop function if exists public.prune_job_route_points();
drop function if exists public.tg_record_route_point();
drop function if exists public.set_job_loaded_at(uuid, text);
drop function if exists public.tg_pickup_check();
drop table if exists public.job_route_points;
drop table if exists public.job_pickup_checks;
commit;
