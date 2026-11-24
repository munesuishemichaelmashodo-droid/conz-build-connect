-- 24/11/2026: undo 20261124_migration_history_repair.sql. METADATA ONLY. Owner runs it by hand in the
-- Supabase SQL editor; never an agent or CI.
--
-- What it does: removes ONLY the 36 rows the repair added and puts back ONLY the six stand-in rows it
-- removed, copied from supabase_migrations.schema_migrations_backup_20261124_repair. Every other row,
-- including versions recorded after the repair (0170, 0171, ...), is left exactly as it is. The backup
-- table is kept.
--
-- MODES (edit `c_mode`): 'check' read-only preconditions; 'dry_run' does the undo then rolls it back with
-- "DRY RUN OK"; 'apply' commits. Ships in 'check' mode.
--
-- It refuses to run if: the backup table is missing; the backup's row count or md5 no longer match the
-- values recorded in its COMMENT when it was taken; the backup does not hold the six stand-ins; the 36 git
-- versions are not all recorded, or any of them now has statements recorded (meaning something other than
-- the repair wrote them: stop and look); any stand-in is already back; the delete/insert touch other than
-- 36 / 6 rows; or the result is not (rows before - 30).

begin;

do $undo$
declare
  c_mode   constant text := 'check';                 -- 'check' | 'dry_run' | 'apply'
  c_backup constant text := 'schema_migrations_backup_20261124_repair';
  v_git    constant text[] :=
    array['20261007210000','20261007220000','20261007230000','20261008000000','20261008010000','20261008020000','20261008030000','20261008040000','20261008050000','20261008060000','20261008070000','20261008080000','20261008090000','20261008100000','20261008110000','20261010100000','20261010110000','20261010120000','20261010130000','20261010140000','20261011200000','20261011210000','20261012000000','20261012010000','20261012100000','20261012200000','20261012300000','20261012310000','20261012320000','20261012330000','20261012340000','20261012360000','20261012370000','20261013160000','20261013170000','20261019230000'];
  v_stand_ins constant text[] :=
    array['20261007231311','20261008045004','20261008045240','20261008045317','20261008045551','20261013093236'];
  v_comment text; v_bak_count bigint; v_bak_md5 text; v_rows_before bigint; n bigint;
begin
  if c_mode not in ('check', 'dry_run', 'apply') then
    raise exception 'STOP: c_mode must be check, dry_run or apply (got %)', c_mode;
  end if;
  if c_mode = 'check' then
    perform set_config('transaction_read_only', 'on', true);
  else
    lock table supabase_migrations.schema_migrations in share row exclusive mode;
  end if;

  if to_regclass('supabase_migrations.' || c_backup) is null then
    raise exception 'STOP: backup table supabase_migrations.% does not exist; nothing to restore from', c_backup;
  end if;
  v_comment := obj_description(('supabase_migrations.' || c_backup)::regclass, 'pg_class');
  execute format('select count(*), md5(coalesce(string_agg(t::text, E''\n'' order by t.version), '''')) from supabase_migrations.%I t', c_backup)
    into v_bak_count, v_bak_md5;
  if v_comment is null or position(format('rows=%s md5=%s', v_bak_count, v_bak_md5) in v_comment) = 0 then
    raise exception 'STOP: backup no longer matches what was recorded when it was taken (comment: %; now rows=% md5=%)', v_comment, v_bak_count, v_bak_md5;
  end if;
  execute format('select count(*) from supabase_migrations.%I where version = any ($1)', c_backup) into n using v_stand_ins;
  if n <> 6 then raise exception 'STOP: backup holds % of the 6 stand-in rows', n; end if;

  select count(*) into n from supabase_migrations.schema_migrations where version = any (v_git);
  if n <> 36 then raise exception 'STOP: % of the 36 git versions are recorded; the repair is not (fully) applied', n; end if;
  select count(*) into n from supabase_migrations.schema_migrations
   where version = any (v_git) and statements is not null;
  if n <> 0 then raise exception 'STOP: % of the 36 git versions now have statements recorded: not written by the repair', n; end if;
  select count(*) into n from supabase_migrations.schema_migrations where version = any (v_stand_ins);
  if n <> 0 then raise exception 'STOP: % stand-in versions are already recorded again', n; end if;

  select count(*) into v_rows_before from supabase_migrations.schema_migrations;
  raise notice 'UNDO PREFLIGHT OK (mode %): % rows; backup verified (rows %, md5 %)', c_mode, v_rows_before, v_bak_count, v_bak_md5;
  if c_mode = 'check' then return; end if;

  delete from supabase_migrations.schema_migrations where version = any (v_git);
  get diagnostics n = row_count;
  if n <> 36 then raise exception 'STOP: deleted % rows, expected 36', n; end if;

  execute format('insert into supabase_migrations.schema_migrations select * from supabase_migrations.%I where version = any ($1)', c_backup)
    using v_stand_ins;
  get diagnostics n = row_count;
  if n <> 6 then raise exception 'STOP: restored % rows, expected 6', n; end if;

  select count(*) into n from supabase_migrations.schema_migrations;
  if n <> v_rows_before - 30 then raise exception 'STOP: % rows after undo, expected %', n, v_rows_before - 30; end if;
  -- Every row that was in the backup and is not one of the 36 must now be identical to its backup copy.
  execute format($q$select count(*) from supabase_migrations.%I b
                   where not exists (select 1 from supabase_migrations.schema_migrations s
                                      where s.version = b.version and s::text = b::text)$q$, c_backup) into n;
  if n <> 0 then raise exception 'STOP: % backed-up rows differ from the live table after undo', n; end if;

  if c_mode = 'dry_run' then
    raise exception 'DRY RUN OK: undo would take rows % -> %. Nothing was kept.', v_rows_before, v_rows_before - 30;
  end if;
  raise notice 'UNDONE: rows % -> %. Backup table kept.', v_rows_before, v_rows_before - 30;
end
$undo$;

commit;
