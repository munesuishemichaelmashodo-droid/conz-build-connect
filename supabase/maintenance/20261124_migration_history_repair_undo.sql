-- Undo 20261124_migration_history_repair.sql: put schema_migrations back exactly as it was before.
-- Metadata only. Run in the SQL editor.
begin;
delete from supabase_migrations.schema_migrations;
insert into supabase_migrations.schema_migrations select * from supabase_migrations.schema_migrations_backup_20261124;
select count(*) as rows_restored from supabase_migrations.schema_migrations;
commit;
