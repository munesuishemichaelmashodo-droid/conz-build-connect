#!/usr/bin/env bash
# Multi-connection race checks for direct-payment records (0179/0188) that single-session pgTAP cannot express.
#
# *** DISPOSABLE LOCAL DATABASE ONLY. NEVER point this at the hosted/production project. ***
# It commits its own users and jobs. Use the .dbtest local stack (migrations + test helpers applied).
# Usage: PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres ./scripts/db-payment-concurrency-check.sh
set -u
case "${PGHOST:-}${PGDATABASE:-}" in *supabase.co*|*prod*) echo "refusing: looks like a hosted database"; exit 2;; esac
Q() { psql -v ON_ERROR_STOP=0 -At -q "$@"; }
fail=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=1; }
N=$(date +%s%N | cut -c1-15)
T=$(mktemp -d)

Q -c "alter table public.jobs disable trigger trg_jobs_one_active_per_driver" >/dev/null
mk() {  # customer, driver, price -> job id (accepted, direct)
  Q -c "select tests.create_job('$1', $3, 'direct')" | head -1
}
read -r C1 C2 D1 D2 <<<"$(Q -c "select tests.create_user('pc_c1_$N'), tests.create_user('pc_c2_$N'), tests.create_driver('pc_d1_$N',100), tests.create_driver('pc_d2_$N',100)" | tr '|' ' ')"
J1=$(mk "$C1" "$D1" 200); J2=$(mk "$C2" "$D2" 200)
for pair in "$J1:$D1:$C1" "$J2:$D2:$C2"; do
  IFS=: read -r J D C <<<"$pair"
  B=$(Q -c "select tests.create_bid('$J','$D',200)")
  Q -c "begin; select tests.login_as('$C'); select public.accept_bid('$B'); commit;" >/dev/null
done
MONEY0=$(Q -c "select string_agg(user_id::text||balance::text||coalesce(held,0)::text, ',' order by user_id) from public.wallets where user_id in ('$D1','$D2')")

# ---- P1: two customers give the SAME reference at the same moment on different jobs -> exactly one accepted
Q -c "begin; select tests.login_as('$C1'); select 'ok:'||(public.customer_claim_stage_payment('$J1','full','ecocash',200,'RACE-$N')).id; select pg_sleep(1); commit;" >$T/p1a 2>&1 &
Q -c "begin; select tests.login_as('$C2'); select 'ok:'||(public.customer_claim_stage_payment('$J2','full','ecocash',200,'race $N')).id; select pg_sleep(1); commit;" >$T/p1b 2>&1 &
wait
WIN=$(cat $T/p1a $T/p1b | grep -c '^ok:'); REF=$(cat $T/p1a $T/p1b | grep -c 'already used for another payment')
USED=$(Q -c "select count(*) from public.direct_payment_stages where public.normalise_payment_reference(customer_reference) = public.normalise_payment_reference('RACE-$N')")
[ "$WIN" = 1 ] && [ "$REF" = 1 ] && [ "$USED" = 1 ] && ok "P1 same reference on two jobs at once -> 1 accepted, 1 refused" || bad "P1 winners=$WIN refused=$REF stored=$USED"

# ---- P2: 6 parallel driver confirmations with different amounts on one stage -> one recorded, one event
for i in $(seq 1 6); do
  Q -c "begin; select tests.login_as('$D2'); select 'ok:'||(public.driver_confirm_stage_payment('$J2','full','ecocash',$((190+i)))).driver_amount; commit;" >$T/p2_$i 2>&1 &
done; wait
WIN=$(cat $T/p2_* | grep -c '^ok:'); EV=$(Q -c "select count(*) from public.direct_payment_stage_events where job_id='$J2' and action='driver_confirmed'")
[ "$WIN" = 1 ] && [ "$EV" = 1 ] && ok "P2 6 parallel different confirmations -> 1 recorded, 1 history event" || bad "P2 winners=$WIN events=$EV"

# ---- P3: 6 parallel identical customer claims -> one event (repeats are harmless)
for i in $(seq 1 6); do
  Q -c "begin; select tests.login_as('$C2'); select 'ok:'||(public.customer_claim_stage_payment('$J2','full','cash',200)).id; commit;" >$T/p3_$i 2>&1 &
done; wait
EV=$(Q -c "select count(*) from public.direct_payment_stage_events where job_id='$J2' and action='customer_claimed'")
[ "$EV" = 1 ] && ok "P3 6 parallel identical claims -> 1 history event" || bad "P3 events=$EV"

# ---- P4: 6 parallel disputes on one stage -> one open dispute
for i in $(seq 1 6); do
  Q -c "begin; select tests.login_as('$C2'); select 'ok:'||(public.flag_stage_payment('$J2','full','disputed','Amount is wrong, attempt $i')).id; commit;" >$T/p4_$i 2>&1 &
done; wait
RV=$(Q -c "select count(*) from public.direct_payment_stage_reviews where job_id='$J2' and action='disputed'")
[ "$RV" = 1 ] && ok "P4 6 parallel disputes -> 1 recorded" || bad "P4 disputes=$RV"

MONEY1=$(Q -c "select string_agg(user_id::text||balance::text||coalesce(held,0)::text, ',' order by user_id) from public.wallets where user_id in ('$D1','$D2')")
[ "$MONEY0" = "$MONEY1" ] && ok "P5 no driver wallet or held commission changed" || bad "P5 wallets changed"
Q -c "alter table public.jobs enable trigger trg_jobs_one_active_per_driver" >/dev/null
rm -rf "$T"
exit $fail
