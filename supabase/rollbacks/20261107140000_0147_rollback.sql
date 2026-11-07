-- Undo 0147. Contains DROP: run in the SQL editor. Jobs already reopened stay open.
drop function if exists public.customer_reopen_no_show_job(uuid);
