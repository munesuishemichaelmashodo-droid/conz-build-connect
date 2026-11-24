-- Schema fingerprint used to compare rebuilt staging with the CI-built database. Read-only.
-- Function bodies are compared with comments and whitespace removed. Extension members are ignored.
select line from (
  select 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') body=' ||
         md5(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s', '', 'g')) ||
         ' definer=' || p.prosecdef || ' config=' || coalesce(array_to_string(p.proconfig, ','), '') as line
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'exec ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') anon=' ||
         has_function_privilege('anon', p.oid, 'EXECUTE') || ' auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' null=' || is_nullable ||
         ' default=' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all
  select 'tbl ' || c.relname || ' rls=' || c.relrowsecurity || ' anon_write=' ||
         has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') || ' auth_write=' ||
         has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'pol ' || schemaname || '.' || tablename || '.' || policyname || ' ' || cmd || ' ' || roles::text || ' ' ||
         md5(coalesce(qual, '') || '|' || coalesce(with_check, ''))
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'trg ' || n.nspname || '.' || c.relname || '.' || t.tgname || ' ' || md5(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'auth', 'storage') and not t.tgisinternal
  union all
  select 'idx ' || indexname || ' ' || md5(indexdef) from pg_indexes where schemaname = 'public'
  union all
  select 'con ' || conrelid::regclass::text || '.' || conname || ' ' || md5(pg_get_constraintdef(oid))
    from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0
  union all
  select 'cron ' || jobname || ' ' || schedule || ' ' || md5(command) from cron.job
  union all
  select 'setting ' || key || '=' || value::text from public.system_settings
) f order by 1;
