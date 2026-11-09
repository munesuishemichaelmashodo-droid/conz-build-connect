-- Undo 0157 (DROP: run in the Supabase SQL editor). Deletes any recorded agreements.
drop function if exists public.decline_job_agreement(uuid);
drop function if exists public.accept_job_agreement(uuid);
drop function if exists public.propose_job_agreement(uuid, text, text, numeric, text, text, text, text);
drop table if exists public.job_agreements;
