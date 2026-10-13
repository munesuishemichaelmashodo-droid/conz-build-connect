#!/usr/bin/env bash
# Rehearses the exact release order against a DISPOSABLE production-like database and probes the stock-advisory
# behaviour after every step that touches it. NEVER point this at the hosted/production project.
#
# Usage (stand-in): TEMPLATE=conz76 PGHOST=/var/tmp/pgsock PGUSER=postgres scripts/ops/rehearse-release-order.sh
#   TEMPLATE = a database built from migrations up to 0076 (production's recorded history).
# It creates database "rehearsal_release", applies the migrations by EXACT filename in the documented order, and
# prints PASS/FAIL for each probe. Production-only unrecorded objects (0077, 0079, 0081-0087) are applied first as the
# "already live" baseline, matching CONZ-RECONCILIATION-0077-0097-2026-10-12.md.
set -u
case "${PGHOST:-}${PGDATABASE:-}" in *supabase.co*|*prod*) echo "refusing: looks like a hosted database"; exit 2;; esac
TEMPLATE="${TEMPLATE:?set TEMPLATE to the 0076-built database}"
DB=rehearsal_release
M="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)"
PSQL="psql -X -q -v ON_ERROR_STOP=1"
fail=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }

$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB template $TEMPLATE" || exit 1
apply() { # exact filename only, own transaction
  local f="$M/$1"; [ -f "$f" ] || { echo "missing $1"; exit 1; }
  $PSQL -1 -d $DB -f "$f" >/tmp/rehearse_$$.err 2>&1 || { echo "APPLY FAILED: $1"; head -5 /tmp/rehearse_$$.err; exit 1; }
  echo "applied $1"
}

# probe: a verified supplier with a BLANK-stock exact-coordinate site must be quotable and offered (stock advisory)
probe() { # $1 label, $2 expected: yes|no
  local out
  out=$($PSQL -At -d $DB <<'SQL' 2>&1
begin;
insert into public.suppliers (id, name, verification_status) values ('00000000-0000-0000-0000-00000000f001','REHEARSAL supplier','verified');
insert into public.material_supply_locations (id, supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
values ('00000000-0000-0000-0000-00000000f002','00000000-0000-0000-0000-00000000f001','stones','supplier','REHEARSAL blank-stock site','x',-17.80,31.05,'active','verified',null,1,200,'exact');
select 'cand=' || count(*) from public.resolve_material_source_candidates('stones', 12, -17.82, 31.04) where supply_location_id = '00000000-0000-0000-0000-00000000f002';
do $$ begin
  begin perform public.create_price_quote_for(null,'stones',12,20,'osrm','00000000-0000-0000-0000-00000000f002'); raise notice 'quote=yes';
  exception when others then raise notice 'quote=no (%)', sqlerrm; end;
end $$;
rollback;
SQL
)
  local cand quote; cand=$(echo "$out" | grep -o 'cand=[0-9]*' | head -1); quote=$(echo "$out" | grep -o 'quote=[a-z]*' | head -1)
  if [ "$2" = yes ]; then
    [ "$cand" = "cand=1" ] && [ "$quote" = "quote=yes" ] && ok "$1: blank-stock site is offered and quotable" || bad "$1: expected offered+quotable, got $cand $quote"
  else
    [ "$cand" = "cand=0" ] && [ "$quote" = "quote=no" ] && ok "$1: (expected hazard) blank-stock site is rejected" || bad "$1: expected rejection, got $cand $quote"
  fi
}

echo "== baseline: production's unrecorded-but-present objects"
for f in 20261008020000_0077_kyc_protection.sql 20261008040000_0079_roles_and_job_visibility.sql 20261008060000_0081_account_deletion.sql 20261008070000_0082_ledger_and_reconciliation.sql 20261008080000_0083_security_invariants.sql 20261008090000_0084_reconcile_live_only_objects.sql 20261008100000_0085_second_audit_fixes.sql 20261008110000_0086_commission_change_mfa.sql 20261010100000_0087_material_sourcing_requests.sql; do apply "$f"; done

echo "== Stage A (no app deploy needed)"
apply 20261012300000_0098_bridge_create_price_quote_for.sql
apply 20261012310000_0099_guard_photo_timestamps_and_sweep_proof.sql
apply 20261012320000_0100_fix_admin_set_diesel_price_audit_call.sql
probe "after Stage A" yes

echo "== Stage B (app first for 0078, 0080, 0096)"
apply 20261008030000_0078_pin_lockout_that_counts.sql
apply 20261008050000_0080_pricing_input_integrity.sql
probe "after 0080 alone" no
apply 20261012330000_0101_stock_is_advisory.sql
probe "after 0101 (right after 0080)" yes
for f in 20261010110000_0088_sourcing_workflow_integrity.sql 20261010120000_0089_geographic_dispatch.sql 20261010130000_0090_sourcing_quote_booking_radius.sql 20261010140000_0091_flat_commission.sql 20261011200000_0092_neutralise_level_commission_multiplier.sql 20261011210000_0093_payment_audit_fixes.sql 20261012000000_0094_withdrawal_payout_tracking.sql 20261012010000_0095_wallet_reservation_failed_payout_limits.sql 20261012100000_0096_delivery_proof_both_modes.sql 20261012200000_0097_withdrawal_pin_recovery.sql; do apply "$f"; done
probe "after 0088-0097" yes
apply 20261012340000_0102_decline_dispatch_offer.sql
apply 20261012350000_0103_pricing_setters_superadmin_stepup.sql
apply 20261012360000_0104_job_supply_confirmation.sql
apply 20261012370000_0105_accept_dispatch_offer_lock_order.sql
probe "final state" yes

echo "== final state sanity"
n=$($PSQL -At -d $DB -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('supply_stock_status','decline_dispatch_offer','confirm_job_supply','create_price_quote_for','verified_quote_supply_for_job','admin_set_diesel_price','admin_set_demand_multiplier')")
[ "$n" = 7 ] && ok "all 7 expected functions exist" || bad "expected 7 functions, found $n"
s=$($PSQL -At -d $DB -c "select count(*) from pg_proc where proname in ('accept_bid','cancel_job','resolve_material_source_candidates','create_price_quote_for','verified_quote_supply_for_job') and prosrc ilike '%available_quantity_m3%'")
[ "$s" = 0 ] && ok "no stock gate remains in any of the 5 functions" || bad "$s function(s) still reference available_quantity_m3"
g=$($PSQL -At -d $DB -c "select (has_function_privilege('anon','public.confirm_job_supply(uuid,text)','execute'))::int + (has_function_privilege('anon','public.decline_dispatch_offer(uuid)','execute'))::int + (has_function_privilege('anon','public.supply_stock_status(uuid,numeric)','execute'))::int + (has_function_privilege('authenticated','public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)','execute'))::int")
[ "$g" = 0 ] && ok "no new function is executable by anon; create_price_quote_for is not client-callable" || bad "unexpected grants ($g)"
[ "${KEEP:-0}" = 1 ] || $PSQL -d postgres -c "drop database if exists $DB" >/dev/null
[ $fail = 0 ] && echo "REHEARSAL PASSED" || { echo "REHEARSAL FAILED"; exit 1; }
