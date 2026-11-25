-- Undo 0177. The gate and functions go; the account tables and their history are KEPT (records are never deleted;
-- drop them by hand only if empty). The switch row stays (false = no effect).
drop trigger if exists trg_jobs_provider_driver_ready on public.jobs;
drop function if exists public.tg_jobs_provider_driver_ready();
drop function if exists public.admin_set_driver_provider_account_suspended(uuid, text, boolean, text);
drop function if exists public.provider_record_driver_account(uuid, text, text, text, text, text, boolean, text);
drop function if exists public.driver_provider_account_ready(uuid, text);
