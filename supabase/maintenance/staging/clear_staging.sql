-- Clears ConZ STAGING (fpckydgssuefzzxivvig) so it can be rebuilt from the repository's migrations.
-- Destructive: removes every app object in schema public (tables, data, functions, types, views, sequences),
-- app storage policies, scheduled jobs, the leftover staging_tools schema and the test auth users.
-- Keeps: extensions (pg_net lives in public), storage buckets and their 3 files, Supabase-managed schemas,
-- and the conz_env.identity marker that proves this database is staging.
-- Run ONLY by scripts/staging/rebuild-staging.sh, which checks the connection target first.
\set ON_ERROR_STOP on

do $$ begin
  if to_regclass('conz_env.identity') is null
     or (select count(*) from conz_env.identity where env = 'staging' and project_ref = 'fpckydgssuefzzxivvig') <> 1 then
    raise exception 'STOP: this database is not marked as ConZ staging (conz_env.identity)';
  end if;
end $$;

-- 1. Scheduled jobs (the migrations schedule their own again).
select cron.unschedule(jobid) from cron.job;

-- 2. App storage policies (migrations create them only when the name is missing, so old ones must go).
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy if exists %I on storage.objects', p.policyname);
  end loop;
end $$;

-- 3. Everything in public that is not owned by an extension.
do $$ declare r record; begin
  for r in select c.oid::regclass::text as n, c.relkind from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('v', 'm')
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop %s if exists %s cascade', case r.relkind when 'm' then 'materialized view' else 'view' end, r.n);
  end loop;
  for r in select c.oid::regclass::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind in ('r', 'p')
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop table if exists %s cascade', r.n);
  end loop;
  for r in select p.oid::regprocedure::text as n, p.prokind from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    execute format('drop %s if exists %s cascade',
                   case r.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, r.n);
  end loop;
  for r in select t.oid::regtype::text as n from pg_type t join pg_namespace s on s.oid = t.typnamespace
            where s.nspname = 'public' and t.typtype in ('e', 'd')
              and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e') loop
    execute format('drop type if exists %s cascade', r.n);
  end loop;
  for r in select c.oid::regclass::text as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'S'
              and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') loop
    execute format('drop sequence if exists %s cascade', r.n);
  end loop;
end $$;

-- 4. Leftovers from the old Payonify staging work.
drop schema if exists staging_tools cascade;

-- 5. Test sign-ins (their profiles went with step 3).
delete from auth.users;

-- 6. A migration history in the Supabase CLI format, empty; the rebuild records every file it applies.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
truncate supabase_migrations.schema_migrations;

-- Must be empty apart from extension members.
select 'left in public: ' || count(*) as check_public
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
 where s.nspname = 'public' and c.relkind in ('r','v','m','S','p')
   and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
