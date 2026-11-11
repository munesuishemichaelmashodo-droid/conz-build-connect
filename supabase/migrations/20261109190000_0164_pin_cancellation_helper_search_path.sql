-- 0164: pin the search path of the two cancellation-reason helpers created in 0148 (Supabase advisor
-- "function_search_path_mutable", 09/11/2026). Both are small immutable SQL functions used in CHECK constraints and
-- in cancel functions; they are SECURITY INVOKER and touch no table. ALTER only: no definition, grant, table or data
-- change. Undo: supabase/rollbacks/20261109190000_0164_rollback.sql.
alter function public.cancellation_reason_known(text) set search_path = public, pg_temp;
alter function public.cancellation_reason_allowed(text, text) set search_path = public, pg_temp;
