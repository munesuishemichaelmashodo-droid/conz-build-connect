-- Undo 0131 (ConZ points). Needs the SQL editor: it drops objects. Points history is lost, so export
-- public.points_ledger first if any real points were awarded.
begin;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'process-points';
  end if;
end $$;
drop function if exists public.admin_reverse_points(uuid, text);
drop function if exists public.admin_adjust_points(uuid, integer, text);
drop function if exists public.admin_save_points_rule(uuid, text, text, public.material_category, integer, numeric, numeric, boolean, timestamptz, timestamptz, text);
drop function if exists public.admin_set_points_enabled(boolean, text);
drop function if exists public.process_points();
drop function if exists public.points_overview();
drop table if exists public.points_ledger;
drop table if exists public.points_rules;
delete from public.system_settings where key = 'points_enabled';
commit;
