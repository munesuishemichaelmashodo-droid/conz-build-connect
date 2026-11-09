-- Undo 0155. Contains DROP: run in the Supabase SQL editor.
drop trigger if exists trg_jobs_money_columns_guard on public.jobs;
drop function if exists public.tg_jobs_money_columns_guard();
