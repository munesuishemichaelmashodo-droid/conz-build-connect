-- Undo 0137: remove the public preview function.
begin;
drop function if exists public.public_open_job_previews(integer);
commit;
