-- Undo 0138: restore the Supabase default table privileges for anon and authenticated.
begin;
grant insert, update, delete, truncate, trigger, references on all tables in schema public to anon;
grant truncate, trigger, references on all tables in schema public to authenticated;
alter default privileges for role postgres in schema public grant insert, update, delete, truncate, trigger, references on tables to anon;
alter default privileges for role postgres in schema public grant truncate, trigger, references on tables to authenticated;
commit;
