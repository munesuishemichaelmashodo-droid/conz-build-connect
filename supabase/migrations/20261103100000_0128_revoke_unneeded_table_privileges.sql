-- -----------------------------------------------------------------------------
-- 0128: remove table privileges nothing needs (defence in depth; no behaviour change).
--
-- Row-level security already blocks everything removed here. This migration stops a
-- future mistaken policy ("to public") from turning an inert grant into a hole.
--
--   Tier 1  anon + authenticated lose TRUNCATE, REFERENCES, TRIGGER on every table in
--           public; anon also loses INSERT, UPDATE, DELETE on every table in public.
--   Tier 2  authenticated loses INSERT / UPDATE / DELETE on a table only where no RLS
--           policy allows that command for authenticated (or public). With no policy,
--           RLS already refused it, so effective access is unchanged. The only visible
--           difference: a refused UPDATE/DELETE now errors (42501) instead of
--           matching zero rows.
--
-- Not touched: default privileges for new tables (separate decision), sequences,
-- column-level grants (e.g. suppliers), views, functions, service_role.
-- No DROP. Owner approval needed before production.
-- Undo: supabase/rollbacks/20261103100000_0128_rollback.sql (exact 03/11/2026 grants).
-- -----------------------------------------------------------------------------

begin;

do $$
declare
  r record;
begin
  -- Tier 1
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.relname);
    execute format('revoke insert, update, delete on public.%I from anon', r.relname);
  end loop;

  -- Tier 2
  for r in
    select c.relname, p.priv
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' and c.relkind in ('r', 'p')
     cross join (values ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) as p(priv, cmd)
     where has_table_privilege('authenticated', c.oid, p.priv)
       and not exists (
             select 1
               from pg_policy pl
              where pl.polrelid = c.oid
                and pl.polcmd in ('*', p.cmd)
                and (pl.polroles = '{0}'::oid[] or 'authenticated'::regrole::oid = any (pl.polroles)))
  loop
    execute format('revoke %s on public.%I from authenticated', r.priv, r.relname);
  end loop;
end $$;

commit;
