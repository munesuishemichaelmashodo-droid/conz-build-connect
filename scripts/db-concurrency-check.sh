#!/usr/bin/env bash
# True multi-connection race checks that single-session pgTAP cannot express.
#
# *** DISPOSABLE LOCAL DATABASE ONLY. NEVER point this at the hosted/production project. ***
# It creates its own users/payments/withdrawals (committed) in the database you give it, so use a
# throw-away copy that already has the repository migrations + tests/test_helpers applied, e.g.:
#   createdb -T <migrated_db> conc_check      (or the .dbtest local stack's postgres DB)
#
# Usage: PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=conc_check ./scripts/db-concurrency-check.sh
set -u
case "${PGHOST:-}${PGDATABASE:-}" in *supabase.co*|*prod*) echo "refusing: looks like a hosted database"; exit 2;; esac
Q() { psql -v ON_ERROR_STOP=0 -At -q "$@"; }
fail=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=1; }
N=$(date +%s)

# ---- setup (as owner) ------------------------------------------------------
read -r DRV ADM1 ADM2 <<<"$(Q -c "select tests.create_driver('cc_drv_$N',100), tests.create_user('cc_a1_$N',array['admin']), tests.create_user('cc_a2_$N',array['admin'])" | tr '|' ' ')"
Q -c "begin; select tests.login_as('$DRV'); select public.set_withdrawal_pin('4826',null); commit;" >/dev/null

# ---- S1: 10 parallel Paynow results for ONE top-up -> exactly one credit --------------------
PAY=$(Q -c "insert into public.payments(user_id,type,amount,currency,method,status) values ('$DRV','topup',25,'USD','paynow','initiated') returning id")
B0=$(Q -c "select balance from public.wallets where user_id='$DRV'")
for i in $(seq 1 10); do
  Q -c "select (public.apply_paynow_result('$PAY','ipn','Paid','25.00','$PAY','PN-$N')->>'outcome')" >/tmp/cc_s1_$i.out 2>&1 &
done; wait
CRED=$(cat /tmp/cc_s1_*.out | grep -c '^credited$'); DUP=$(cat /tmp/cc_s1_*.out | grep -c '^duplicate_ignored$')
B1=$(Q -c "select balance from public.wallets where user_id='$DRV'")
[ "$CRED" = 1 ] && [ "$DUP" = 9 ] && [ "$(echo "$B1 - $B0" | bc)" = 25.00 ] && ok "S1 10 parallel IPNs -> 1 credited, 9 duplicate_ignored, wallet +25.00 once" || bad "S1 credited=$CRED dup=$DUP delta=$(echo "$B1 - $B0" | bc)"
rm -f /tmp/cc_s1_*.out

# ---- S2: one pending withdrawal, 8 parallel approvals -> exactly one debit ------------------
Q -c "begin; select tests.login_as('$DRV'); select public.request_withdrawal(40,'ecocash','0771234567','4826'); commit;" >/dev/null
WD=$(Q -c "select id from public.wallet_withdrawal_requests where user_id='$DRV' and status='pending'")
B0=$(Q -c "select balance from public.wallets where user_id='$DRV'")
for i in $(seq 1 8); do
  A=$([ $((i%2)) = 0 ] && echo $ADM1 || echo $ADM2)
  Q -c "begin; select tests.login_as_mfa('$A'); select 'ok:'||(public.admin_approve_withdrawal('$WD')).balance; commit;" >/tmp/cc_s2_$i.out 2>&1 &
done; wait
WIN=$(cat /tmp/cc_s2_*.out | grep -c '^ok:'); B1=$(Q -c "select balance from public.wallets where user_id='$DRV'")
TX=$(Q -c "select count(*) from public.wallet_transactions where user_id='$DRV' and type='withdrawal' and amount=-40")
[ "$WIN" = 1 ] && [ "$TX" = 1 ] && [ "$(echo "$B0 - $B1" | bc)" = 40.00 ] && ok "S2 8 parallel approvals -> 1 winner, 1 ledger tx, wallet -40.00 once" || bad "S2 winners=$WIN tx=$TX delta=$(echo "$B0 - $B1" | bc)"
rm -f /tmp/cc_s2_*.out

# ---- S3: 8 parallel mark-paid -> one audit entry, first reference wins --------------------
for i in $(seq 1 8); do
  Q -c "begin; select tests.login_as_mfa('$ADM1'); select (public.admin_mark_withdrawal_paid('$WD','REF-$i')).payout_reference; commit;" >/tmp/cc_s3_$i.out 2>&1 &
done; wait
AUD=$(Q -c "select count(*) from public.admin_audit_log where action='withdrawal_payout_recorded' and target_id='$WD'")
DIS=$(cat /tmp/cc_s3_*.out | grep -v '^$' | grep -v 'BEGIN\|COMMIT' | sort -u | wc -l)
[ "$AUD" = 1 ] && [ "$DIS" = 1 ] && ok "S3 8 parallel mark-paid -> 1 audit entry, every caller sees the same reference" || bad "S3 audit=$AUD distinct_refs=$DIS"
rm -f /tmp/cc_s3_*.out

# ---- S4: 8 parallel withdrawal requests by one user -> one pending ------------------------
for i in $(seq 1 8); do
  Q -c "begin; select tests.login_as('$DRV'); select public.request_withdrawal(5,'ecocash','0771234567','4826'); commit;" >/tmp/cc_s4_$i.out 2>&1 &
done; wait
PEND=$(Q -c "select count(*) from public.wallet_withdrawal_requests where user_id='$DRV' and status='pending'")
[ "$PEND" = 1 ] && ok "S4 8 parallel requests -> exactly 1 pending" || bad "S4 pending=$PEND"
rm -f /tmp/cc_s4_*.out

# ---- S5: parallel approve vs cancel on one pending request -> never both -------------------
WD2=$(Q -c "select id from public.wallet_withdrawal_requests where user_id='$DRV' and status='pending'")
B0=$(Q -c "select balance from public.wallets where user_id='$DRV'")
Q -c "begin; select tests.login_as_mfa('$ADM1'); select (public.admin_approve_withdrawal('$WD2')).balance; commit;" >/tmp/cc_s5_a.out 2>&1 &
Q -c "begin; select tests.login_as('$DRV'); select (public.cancel_withdrawal('$WD2')).status; commit;" >/tmp/cc_s5_b.out 2>&1 &
wait
ST=$(Q -c "select status from public.wallet_withdrawal_requests where id='$WD2'"); B1=$(Q -c "select balance from public.wallets where user_id='$DRV'")
if [ "$ST" = approved ] && [ "$(echo "$B0 - $B1" | bc)" = 5.00 ]; then ok "S5 approve won: approved, debited 5.00 once"
elif [ "$ST" = cancelled ] && [ "$B0" = "$B1" ]; then ok "S5 cancel won: cancelled, balance untouched"
else bad "S5 inconsistent: status=$ST delta=$(echo "$B0 - $B1" | bc)"; fi
rm -f /tmp/cc_s5_*.out

# ---- S6: approved withdrawal, 8 parallel "payout failed" -> exactly one reversal; reservation consistent -------
Q -c "begin; select tests.login_as('$DRV'); select public.request_withdrawal(6,'ecocash','0771234567','4826'); commit;" >/dev/null
WD3=$(Q -c "select id from public.wallet_withdrawal_requests where user_id='$DRV' and status='pending'")
Q -c "begin; select tests.login_as_mfa('$ADM1'); select (public.admin_approve_withdrawal('$WD3')).balance; commit;" >/dev/null
B0=$(Q -c "select balance from public.wallets where user_id='$DRV'")
for i in $(seq 1 8); do
  A=$([ $((i%2)) = 0 ] && echo $ADM1 || echo $ADM2)
  Q -c "begin; select tests.login_as_mfa('$A'); select (public.admin_mark_withdrawal_failed('$WD3','concurrent failure test')).status; commit;" >/tmp/cc_s6_$i.out 2>&1 &
done; wait
AMT=$(Q -c "select amount from public.wallet_withdrawal_requests where id='$WD3'")
B1=$(Q -c "select balance from public.wallets where user_id='$DRV'")
REV=$(Q -c "select count(*) from public.wallet_transactions where user_id='$DRV' and type='withdrawal' and amount > 0 and note like '%$WD3%'")
RES=$(Q -c "select (select withdrawal_reserved from public.wallets where user_id='$DRV') = coalesce((select sum(amount) from public.wallet_withdrawal_requests where user_id='$DRV' and status='pending'),0)")
[ "$REV" = 1 ] && [ "$(echo "$B1 - $B0" | bc)" = "$AMT" ] && [ "$RES" = t ] && ok "S6 8 parallel mark-failed -> 1 reversal, balance +$AMT once, reservation consistent" || bad "S6 reversals=$REV delta=$(echo "$B1 - $B0" | bc) amt=$AMT reserved_ok=$RES"
rm -f /tmp/cc_s6_*.out

# ---- S7: delivery proof (0096). 10 parallel customer confirmations of ONE direct-pay job -> settles once ------
CUST=$(Q -c "select tests.create_user('cc_cust_$N')")
DRV2=$(Q -c "select tests.create_driver('cc_drv2_$N',100,true)")
J=$(Q -c "select tests.create_job('$CUST',400)"); BID=$(Q -c "select tests.create_bid('$J','$DRV2',400)")
Q -c "begin; select tests.login_as('$CUST'); select public.accept_bid('$BID'); commit;" >/dev/null
PIN=$(Q -c "select tests.deliver('$J')")
B0=$(Q -c "select balance from public.wallets where user_id='$DRV2'")
for i in $(seq 1 10); do
  Q -c "begin; select tests.login_as('$CUST'); select coalesce(public.complete_job('$J','$PIN')->>'already','settled'); commit;" >/tmp/cc_s7_$i.out 2>&1 &
done; wait
SET=$(cat /tmp/cc_s7_*.out | grep -c '^settled$'); ALR=$(cat /tmp/cc_s7_*.out | grep -c '^true$')
B1=$(Q -c "select balance from public.wallets where user_id='$DRV2'")
LED=$(Q -c "select count(*) from public.wallet_transactions where user_id='$DRV2' and job_id='$J' and type='commission' and amount < 0")
[ "$SET" = 1 ] && [ "$ALR" = 9 ] && [ "$LED" = 1 ] && [ "$(echo "$B0 - $B1" | bc)" = 28.00 ] && ok "S7 10 parallel confirmations -> 1 settlement, 9 already-complete, commission 28.00 charged once" || bad "S7 settled=$SET already=$ALR ledger=$LED delta=$(echo "$B0 - $B1" | bc)"
rm -f /tmp/cc_s7_*.out

# ---- S8: first-job-free race. A newly verified driver, 2 jobs confirmed in parallel -> exactly ONE is free ---------
DRV3=$(Q -c "select tests.create_driver('cc_drv3_$N',100,false)")
J1=$(Q -c "select tests.create_job('$CUST',400)"); J2=$(Q -c "select tests.create_job('$CUST',400)")
BA=$(Q -c "select tests.create_bid('$J1','$DRV3',400)"); BB=$(Q -c "select tests.create_bid('$J2','$DRV3',400)")
Q -c "begin; select tests.login_as('$CUST'); select public.accept_bid('$BA'); select public.accept_bid('$BB'); commit;" >/dev/null
P1=$(Q -c "select tests.deliver('$J1')"); P2=$(Q -c "select tests.deliver('$J2')")
B0=$(Q -c "select balance from public.wallets where user_id='$DRV3'")
Q -c "begin; select tests.login_as('$CUST'); select public.complete_job('$J1','$P1'); commit;" >/tmp/cc_s8_a.out 2>&1 &
Q -c "begin; select tests.login_as('$CUST'); select public.complete_job('$J2','$P2'); commit;" >/tmp/cc_s8_b.out 2>&1 &
wait
B1=$(Q -c "select balance from public.wallets where user_id='$DRV3'")
DONE=$(Q -c "select count(*) from public.jobs where id in ('$J1','$J2') and status='completed'")
LED=$(Q -c "select count(*) filter (where amount = 0) || ',' || count(*) filter (where amount = -28) from public.wallet_transactions where user_id='$DRV3' and type='commission'")
[ "$DONE" = 2 ] && [ "$LED" = "1,1" ] && [ "$(echo "$B0 - $B1" | bc)" = 28.00 ] && ok "S8 2 parallel first-job completions -> both complete, exactly one commission-free, other charged 7% (28.00)" || bad "S8 completed=$DONE ledger=$LED delta=$(echo "$B0 - $B1" | bc)"
rm -f /tmp/cc_s8_*.out

[ $fail = 0 ] && echo "ALL CONCURRENCY CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
