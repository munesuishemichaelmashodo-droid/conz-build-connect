-- Undo for 0144_one_active_job_per_driver.
-- 0144 only added a trigger and its function; nothing existing was replaced, so undoing it is removal.
-- The DROP statements must run in the Supabase SQL editor (the MCP tool hangs on DROP).

drop trigger if exists trg_jobs_one_active_per_driver on public.jobs;
drop function if exists public.tg_one_active_job_per_driver();
