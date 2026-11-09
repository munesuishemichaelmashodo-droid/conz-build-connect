-- Undo 0165: stop the daily clean-up and remove the function. Deleted notifications are not restored.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'prune-old-notifications';
  end if;
end $$;
drop function if exists public.prune_old_notifications();
