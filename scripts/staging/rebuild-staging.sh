#!/usr/bin/env bash
# Rebuild ConZ STAGING (fpckydgssuefzzxivvig) from this repository, the same way CI builds its test database
# (scripts/db-test.mjs): the 13/08 baseline with supabase/test-fixtures/reference_data.sql appended, then every
# later migration in file-name order. Differences from CI, on purpose:
#   * no test helpers (29991231235959_test_helpers.sql is CI-only);
#   * the parked migrations 0130, 0131, 0132, 0137 are left out, as they are for production
#     (supabase/maintenance/20261124_MIGRATION_STATUS.md). No later migration references their objects.
# Each applied file is recorded in supabase_migrations.schema_migrations under its own version.
#
# Usage: STAGING_DATABASE_URL=... scripts/staging/rebuild-staging.sh
# Refuses unless the URL names the staging project, never names production, and the database carries the
# conz_env.identity staging marker. Never prints the URL.
set -euo pipefail

STAGING_REF="fpckydgssuefzzxivvig"
PRODUCTION_REF="ovwrsocjmkpiygipmrdk"
BASELINE="20260813999999"
PARKED_RE='_(0130|0131|0132|0137)_'
DB="${STAGING_DATABASE_URL:-}"
PSQL="${PSQL:-psql}"

[ -n "$DB" ] || { echo "STOP: STAGING_DATABASE_URL is not set"; exit 1; }
case "$DB" in *"$PRODUCTION_REF"*) echo "STOP: the URL names the PRODUCTION project"; exit 1;; esac
if [ "${REHEARSAL:-}" = "local" ]; then
  # Rehearsal on CI's throwaway local Supabase only (same schemas as hosted: auth, storage, cron).
  case "$DB" in postgresql://*@127.0.0.1:*) echo "Rehearsal on a local database.";; *) echo "STOP: rehearsal is local only"; exit 1;; esac
else
  case "$DB" in *"$STAGING_REF"*) ;; *) echo "STOP: the URL does not name the staging project"; exit 1;; esac
fi

q() { "$PSQL" "$DB" -X -v ON_ERROR_STOP=1 -At -q -c "$1"; }
marker=$(q "select count(*) from conz_env.identity where env = 'staging' and project_ref = '$STAGING_REF'" 2>/dev/null || echo 0)
[ "$marker" = "1" ] || { echo "STOP: the database has no ConZ staging marker"; exit 1; }
echo "Target confirmed: ConZ staging ($STAGING_REF)."

cd "$(git rev-parse --show-toplevel)"
mapfile -t FILES < <(ls supabase/migrations | grep -E '^[0-9]{14}_.+\.sql$' | awk -v b="$BASELINE" 'substr($0,1,14) >= b' | grep -vE "$PARKED_RE" | sort)
echo "Migrations to apply: ${#FILES[@]} (${FILES[0]} .. ${FILES[-1]})"
echo "Left out (parked): $(ls supabase/migrations | grep -E "$PARKED_RE" | tr '\n' ' ')"

echo "== Clearing staging"
"$PSQL" "$DB" -X -v ON_ERROR_STOP=1 -q -f supabase/maintenance/staging/clear_staging.sql

tmp=$(mktemp -d)
n=0
for f in "${FILES[@]}"; do
  src="supabase/migrations/$f"
  if [ "${f:0:14}" = "$BASELINE" ]; then
    cat "$src" > "$tmp/baseline.sql"; printf '\n\n' >> "$tmp/baseline.sql"
    cat supabase/test-fixtures/reference_data.sql >> "$tmp/baseline.sql"
    src="$tmp/baseline.sql"
  fi
  if ! "$PSQL" "$DB" -X -v ON_ERROR_STOP=1 -q -f "$src" > "$tmp/out.log" 2>&1; then
    echo "FAILED at $f"; grep -E "ERROR|DETAIL|CONTEXT|LINE" "$tmp/out.log" | head -20; exit 1
  fi
  version="${f:0:14}"; name="${f:15}"; name="${name%.sql}"
  q "insert into supabase_migrations.schema_migrations (version, name, created_by) values ('$version', '$name', 'scripts/staging/rebuild-staging.sh')" >/dev/null
  n=$((n + 1))
done
echo "Applied and recorded: $n migrations."

echo "== Checks"
q "select 'history rows: ' || count(*) || ', latest ' || max(version) from supabase_migrations.schema_migrations"
q "select 'public tables: ' || count(*) from pg_tables where schemaname = 'public'"
q "select 'public functions: ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"
q "select 'provider tables present: ' || count(*) || '/7' from pg_tables where schemaname = 'public' and tablename in ('provider_payment_events','driver_payables','driver_payouts','provider_fees','driver_recoveries','provider_payment_refs','admin_authenticator_checks')"
q "select 'payonify leftovers: ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike '%payonify%'"
q "select 'reconciliation not ok: ' || count(*) from public.financial_reconciliation() where not ok"
q "select 'setting ' || key || '=' || value::text from public.system_settings where key in ('payment_provider','payouts_enabled','escrow_enabled','withdrawals_enabled','commission_rate','transport_pricing_enabled') order by 1"
