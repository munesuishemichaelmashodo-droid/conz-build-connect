-- Undo 0148 (structured cancellation reasons). Contains DROP: run in the SQL editor.
-- No existing function is restored because 0148 changed none (cancel_job, the sweep and the commission
-- functions are untouched). Recorded categories are lost with the columns; free-text reasons are unaffected.
drop trigger if exists trg_jobs_cancellation_code on public.jobs;
drop trigger if exists trg_cancellation_events_code_guard on public.cancellation_events;
drop function if exists public.record_cancellation_reason(uuid, text);
drop function if exists public.tg_jobs_cancellation_code();
drop function if exists public.tg_cancellation_events_code_guard();
drop index if exists public.jobs_cancellation_reason_code_idx;
drop index if exists public.cancellation_events_reason_code_idx;
alter table public.jobs drop column if exists cancellation_reason_code;
alter table public.cancellation_events drop column if exists reason_code;
drop function if exists public.cancellation_reason_allowed(text, text);
drop function if exists public.cancellation_reason_known(text);
