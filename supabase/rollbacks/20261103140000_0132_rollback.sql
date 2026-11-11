-- Undo 0132 (verification SLA). Needs the SQL editor (drops objects). Export verification_events first if you want to keep the timeline.
begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'flag-overdue-verifications';
  end if;
end $$;
drop trigger if exists trg_driver_verification_events on public.driver_profiles;
drop function if exists public.admin_set_business_holiday(date, text, boolean, text);
drop function if exists public.flag_overdue_verifications();
drop function if exists public.admin_verification_queue();
drop function if exists public.tg_driver_verification_events();
drop function if exists public.business_hours_elapsed(timestamptz, timestamptz);
drop table if exists public.verification_events;
drop table if exists public.business_holidays;
delete from public.system_settings where key = 'verification_sla_hours';
commit;
