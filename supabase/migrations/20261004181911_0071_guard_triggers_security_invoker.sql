-- 0071 — Re-enable the client-write guard triggers (they were silently off).
--
-- Every guard below starts with
--     if current_user not in ('authenticated', 'anon') then return new; end if;
-- to let server-side code (SECURITY DEFINER RPCs, service role) through.
-- That test only works if the trigger function itself runs as the caller.
-- These were declared SECURITY DEFINER, so inside them current_user is
-- always the owner (postgres) and the guard returned immediately for every
-- write — including PostgREST client writes. Verified live on 04/10/2026
-- (each in a rolled-back transaction, as role authenticated):
--   * a user inserted their own driver_profiles row with
--     verification_status = 'verified' (self-verification);
--   * a customer UPDATEd their accepted job to status = 'completed',
--     commission = 0 (skipping complete_job and the commission).
--
-- jobs_guard_direct_write was SECURITY INVOKER (and working) until 0066
-- recreated it as SECURITY DEFINER; the insert guards and profile guards
-- from 0066 never worked. storage_protect_evidence has been DEFINER since
-- before the 13/08 baseline (storage RLS already blocks driver
-- UPDATE/DELETE on job-proof-photos, so that one had no practical effect).
--
-- Fix: SECURITY INVOKER, matching the guards that work
-- (bids_guard_direct_write, driver_profiles_guard_direct_write,
-- jobs_guard_arrival_fields). None of these functions read other tables
-- except via has_role(), which is itself SECURITY DEFINER, so running as
-- the caller changes nothing else. Server paths are unaffected: their
-- writes happen inside SECURITY DEFINER RPCs (current_user = owner) or as
-- service_role, both of which still pass the early return.
--
-- Skips any function that doesn't exist, so it is safe to replay on a
-- database that predates 0066.

do $$
declare _f text;
begin
  foreach _f in array array[
    'public.jobs_guard_direct_write()',
    'public.jobs_guard_insert()',
    'public.bids_guard_insert()',
    'public.driver_profiles_guard_insert()',
    'public.profiles_guard_insert()',
    'public.profiles_guard_update()',
    'public.storage_protect_evidence()'
  ] loop
    if to_regprocedure(_f) is not null then
      execute format('alter function %s security invoker', _f);
    end if;
  end loop;
end $$;
