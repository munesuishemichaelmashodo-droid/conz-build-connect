#!/usr/bin/env bash
# Local test of 20261124_migration_history_repair.sql and its undo. NEVER points at production:
# it creates and drops its own database `conz_repair_test` on a LOCAL server only (socket or 127.0.0.1/localhost).
# Usage: PGHOST=/tmp PGPORT=55432 PGUSER=postgres bash supabase/maintenance/20261124_migration_history_repair.test.sh
set -uo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "refusing: PGHOST must be a local socket dir or localhost"; exit 2;; esac
DIR="$(cd "$(dirname "$0")" && pwd)"
REPAIR="$DIR/20261124_migration_history_repair.sql"; UNDO="$DIR/20261124_migration_history_repair_undo.sql"
DB=conz_repair_test; PASS=0; FAIL=0
q()  { psql -X -q -tA -d "$DB" -c "$1"; }
run(){ # run <file> <mode> [sed-extra] -> prints psql output, returns psql status
  sed -e "s/c_mode   constant text := 'check'/c_mode   constant text := '$2'/" ${3:+-e "$3"} "$1" \
    | psql -X -q -v ON_ERROR_STOP=1 -d "$DB" 2>&1; }
ok() { if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "ok   - $3"; else FAIL=$((FAIL+1)); echo "FAIL - $3 (got [$1] want [$2])"; fi; }
has(){ if grep -q -- "$2" <<<"$1"; then PASS=$((PASS+1)); echo "ok   - $3"; else FAIL=$((FAIL+1)); echo "FAIL - $3"; echo "$1" | head -5; fi; }
GIT=$(grep -m1 -oE "array\['2026100721[^]]*\]" "$REPAIR")
FNS=$(awk '/v_functions constant text\[\] := array\[/{f=1;next} f&&/\];/{exit} f' "$REPAIR" | tr -d ' \n')
fixture(){
  psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
  q "create schema supabase_migrations;
     create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text,
       created_by text, idempotency_key text unique, rollback text[]);
     insert into supabase_migrations.schema_migrations (version, statements, name)
       select to_char(timestamp '2026-08-13' + i * interval '1 hour','YYYYMMDDHH24MISS'), array['select '||i], 'm'||i
       from generate_series(1,40) i;
     insert into supabase_migrations.schema_migrations (version, statements, name) values
       ('20261007231311',array['x'],'financial_numeric_integrity'),('20261008045004',array['x'],'a'),
       ('20261008045240',array['x'],'b'),('20261008045317',array['x'],'c'),('20261008045551',array['x'],'d'),
       ('20261013093236',array['x'],'bridge'),('20261022100000',array['x'],'0109'),('20261109190000',array['x'],'0164');
     do \$\$ declare f text; begin foreach f in array $(sed "s/^/array[/; s/\$/]/" <<<"$FNS") loop
       execute format('create function public.%I() returns int language sql as ''select 1''', f); end loop; end \$\$;" >/dev/null
}
BEFORE_MD5="select md5(string_agg(t::text, E'\n' order by version)) from supabase_migrations.schema_migrations t"

echo "# 1. check mode is read-only and reports"
fixture; m0=$(q "$BEFORE_MD5")
out=$(run "$REPAIR" check); has "$out" "PREFLIGHT OK (mode check): 48 rows" "check passes on expected state"
ok "$(q "$BEFORE_MD5")" "$m0" "check changed nothing"
ok "$(q "select count(*) from pg_tables where tablename like 'schema_migrations_backup%'")" "0" "check created no backup"
out=$(sed "s/^    perform set_config('transaction_read_only', 'on', true);/&\n    create table public.should_fail(i int);/" "$REPAIR" | psql -X -q -d "$DB" 2>&1)
has "$out" "read-only transaction" "a write attempted in check mode is refused by the database"

echo "# 2. dry_run keeps nothing"
out=$(run "$REPAIR" dry_run); has "$out" "DRY RUN OK" "dry run reaches the end"; has "$out" "48 -> 78" "dry run reports row change"
ok "$(q "$BEFORE_MD5")" "$m0" "dry run changed nothing"
ok "$(q "select count(*) from pg_tables where tablename like 'schema_migrations_backup%'")" "0" "dry run left no backup"

echo "# 3. apply"
out=$(run "$REPAIR" apply); has "$out" "APPLIED: rows 48 -> 78" "apply succeeds"
ok "$(q "select count(*) from supabase_migrations.schema_migrations where version = any ($GIT)")" "36" "36 git versions recorded"
ok "$(q "select count(*) from supabase_migrations.schema_migrations where version in ('20261007231311','20261013093236')")" "0" "stand-ins retired"
ok "$(q "select md5(string_agg(t::text, E'\n' order by version)) from supabase_migrations.schema_migrations_backup_20261124_repair t")" "$m0" "backup equals pre-repair table"
has "$(q "select obj_description('supabase_migrations.schema_migrations_backup_20261124_repair'::regclass,'pg_class')")" "rows=48 md5=$m0" "backup comment records count and checksum"

echo "# 4. re-running apply is refused (backup exists), state unchanged"
m1=$(q "$BEFORE_MD5"); out=$(run "$REPAIR" apply); has "$out" "already exists" "second apply refused"
ok "$(q "$BEFORE_MD5")" "$m1" "refused run changed nothing"
out=$(run "$REPAIR" apply "s/_20261124_repair'/_20261124_repair2'/"); has "$out" "already recorded" "with a new backup name it still refuses (git versions present)"
ok "$(q "select count(*) from pg_tables where tablename='schema_migrations_backup_20261124_repair2'")" "0" "refused run left no second backup"

echo "# 5. undo keeps rows added after the repair"
q "insert into supabase_migrations.schema_migrations (version, statements, name) values ('20261124100000', array['x'], '0170_driver_public_profiles_verified_only')"
out=$(run "$UNDO" check); has "$out" "UNDO PREFLIGHT OK (mode check): 79 rows" "undo check passes"
out=$(run "$UNDO" dry_run); has "$out" "DRY RUN OK: undo would take rows 79 -> 49" "undo dry run"
ok "$(q "select count(*) from supabase_migrations.schema_migrations")" "79" "undo dry run kept nothing"
out=$(run "$UNDO" apply); has "$out" "UNDONE: rows 79 -> 49" "undo applies"
ok "$(q "select md5(string_agg(t::text, E'\n' order by version)) from supabase_migrations.schema_migrations t where version <> '20261124100000'")" "$m0" "history identical to before the repair"
ok "$(q "select count(*) from supabase_migrations.schema_migrations where version='20261124100000'")" "1" "later version 0170 kept"
out=$(run "$UNDO" apply); has "$out" "STOP: 0 of the 36" "second undo refused"

echo "# 6. preconditions fail safe"
fixture; m0=$(q "$BEFORE_MD5")
q "insert into supabase_migrations.schema_migrations (version,name) values ('20261008020000','0077_kyc_protection')"
out=$(run "$REPAIR" apply); has "$out" "1 of the 36 git versions are already recorded" "partial earlier repair detected"
fixture; q "delete from supabase_migrations.schema_migrations where version='20261013093236'"
out=$(run "$REPAIR" apply); has "$out" "found 5" "missing stand-in detected"
fixture; q "drop function public.accept_dispatch_offer()"
out=$(run "$REPAIR" apply); has "$out" "accept_dispatch_offer" "missing live function detected and named"
fixture; q "alter table supabase_migrations.schema_migrations add column must_fill text not null default 'x'; alter table supabase_migrations.schema_migrations alter column must_fill drop default"
out=$(run "$REPAIR" apply); has "$out" "must_fill" "unexpected required column detected"
fixture; q "create table supabase_migrations.schema_migrations_backup_20261124_repair(x int)"
out=$(run "$REPAIR" check); has "$out" "already exists" "existing backup detected even in check mode"
ok "$(q "$BEFORE_MD5")" "$m0" "failed runs changed nothing"
out=$(run "$REPAIR" bogus); has "$out" "c_mode must be" "unknown mode refused"
fixture; out=$(run "$REPAIR" apply "s/'0108_fix_budget_trigger_unassigned_loc'\]/'0108_fix_budget_trigger_unassigned_loc','extra']/"); has "$out" "lists in this file were edited" "edited list refused"
fixture; run "$REPAIR" apply >/dev/null; q "update supabase_migrations.schema_migrations_backup_20261124_repair set name='tampered' where version='20261013093236'"
out=$(run "$UNDO" apply); has "$out" "no longer matches" "undo refuses a changed backup"
fixture; run "$REPAIR" apply >/dev/null; q "update supabase_migrations.schema_migrations set statements=array['x'] where version='20261008020000'"
out=$(run "$UNDO" apply); has "$out" "now have statements recorded" "undo refuses rows it did not write"

psql -X -q -d postgres -c "drop database $DB" >/dev/null
echo "# pass=$PASS fail=$FAIL"; [ "$FAIL" = 0 ]
