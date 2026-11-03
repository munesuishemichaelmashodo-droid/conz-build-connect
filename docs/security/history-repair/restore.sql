-- Restore the migration history exactly as it was before repair.sql (03/11/2026). Metadata only. No DROP.
-- Leaves schema_migrations_backup_20261103 in place; remove it later in the SQL editor if you want.
begin;
do $$ begin
  if to_regclass('supabase_migrations.schema_migrations_backup_20261103') is null then
    raise exception 'Backup table not found; nothing was changed.';
  end if;
end $$;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations
  select * from supabase_migrations.schema_migrations_backup_20261103;
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 149 then
    raise exception 'Restored row count is not 149; nothing was changed.';
  end if;
end $$;
commit;
