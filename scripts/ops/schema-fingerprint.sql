-- READ-ONLY schema fingerprint for ConZ (public schema).
-- Run the same file against production and against a restored copy, save each output, and diff:
--   psql "$CONN" -X -A -t -f scripts/ops/schema-fingerprint.sql | sort > fp-<where>.txt
--   diff fp-prod.txt fp-restore.txt        # empty diff = same functions, tables, columns, triggers, policies, constraints, indexes
-- Contains object names and md5 hashes only: no customer data, no secrets.
-- Whitespace is collapsed before hashing; non-ASCII text IS hashed (so encoding corruption shows up as a difference).
select 'f|'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(regexp_replace(pg_get_functiondef(p.oid),'\s+',' ','g'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')
union all select 't|'||c.relname||'|'||c.relkind::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m')
union all select 'c|'||table_name||'.'||column_name||'|'||md5(data_type||udt_name||is_nullable||coalesce(column_default,'')) from information_schema.columns where table_schema='public'
union all select 'g|'||c.relname||'.'||t.tgname||'|'||md5(regexp_replace(pg_get_triggerdef(t.oid),'\s+',' ','g')) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal
union all select 'p|'||tablename||'.'||policyname||'|'||md5(coalesce(cmd,'')||coalesce(qual,'')||coalesce(with_check,'')||roles::text) from pg_policies where schemaname='public'
union all select 'k|'||c.relname||'.'||o.conname||'|'||md5(pg_get_constraintdef(o.oid)) from pg_constraint o join pg_class c on c.oid=o.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
union all select 'i|'||tablename||'.'||indexname||'|'||md5(regexp_replace(indexdef,'\s+',' ','g')) from pg_indexes where schemaname='public'
union all select 'e|'||extname||'|'||extversion from pg_extension
union all select 'j|'||jobname||'|'||schedule||'|'||md5(command) from cron.job;
