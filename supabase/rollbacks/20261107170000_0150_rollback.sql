-- Undo 0150. Contains DROP: run in the SQL editor.
-- customer_reopen_no_show_job goes back to the 0147 body (md5 6a070c1e4d2b8b32a011a27627f58bed, whitespace stripped);
-- re-run supabase/migrations/20261107140000_0147_customer_reopen_no_show.sql AFTER this script to restore it exactly.
drop function if exists public.admin_marketplace_metrics(integer);
drop trigger if exists trg_jobs_recovery_guard on public.jobs;
drop function if exists public.tg_jobs_recovery_guard();
alter table public.jobs drop column if exists no_show_reopened_at;
