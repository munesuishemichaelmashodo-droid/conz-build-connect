-- -----------------------------------------------------------------------------
-- 0138: remove table privileges the app never needs.
--
-- Supabase gives anon and authenticated every privilege on every table in public. Row security limits
-- INSERT/UPDATE/DELETE/SELECT, but TRUNCATE, TRIGGER and REFERENCES are NOT limited by row security, and a
-- signed-out visitor never writes to a table directly (all anonymous actions go through the five
-- functions on the allowlist in test 120).
--   * anon: loses INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES on every table and view in public (keeps SELECT
--     where a policy or grant already allows it).
--   * authenticated: loses TRUNCATE, TRIGGER, REFERENCES (keeps INSERT/UPDATE/DELETE, still limited by RLS).
--   * Future tables created by postgres in public get the same narrower defaults.
-- No DROP. No data, policy, function or pricing change. Undo: supabase/rollbacks/20261103200000_0138_rollback.sql
-- -----------------------------------------------------------------------------

begin;

revoke insert, update, delete, truncate, trigger, references on all tables in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public revoke insert, update, delete, truncate, trigger, references on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from authenticated;

commit;
