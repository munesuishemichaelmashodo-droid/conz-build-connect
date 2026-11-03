-- 0121: automatic driver payouts for Con Z Pay jobs paid through Payonify.
begin;
select plan(52);
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 0)::text, true);
select set_config('t.drv2',  tests.create_driver('drv2', 0)::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);
select set_config('t.sup',   tests.create_user('sup', array['super_admin'])::text, true);

-- A Con Z Pay job for _driver, paid ($300) through Payonify (test mode) or Paynow.
create or replace function pg_temp.paid_job(_driver uuid, _provider text default 'payonify')
returns uuid language plpgsql as $$
declare _j uuid; _p uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow');
  update public.jobs set status = 'accepted', driver_id = _driver, final_price = 300 where id = _j;
  if _provider = 'payonify' then
    insert into public.payments (user_id, job_id, type, amount, currency, method, status, provider, provider_livemode)
    values (current_setting('t.cust')::uuid, _j, 'escrow', 300, 'USD', 'payonify', 'initiated', 'payonify', false)
    returning id into _p;
    perform tests.as_service();
    perform public.apply_payonify_charge(_p, 'ipn', 'evt_' || _p, 'ch_' || left(_p::text, 8), 'succeeded',
                                         30000, 'usd', false, _p::text);
  else
    insert into public.payments (user_id, job_id, type, amount, currency, method, status, paynow_poll_url)
    values (current_setting('t.cust')::uuid, _j, 'escrow', 300, 'USD', 'paynow', 'initiated',
            'https://www.paynow.co.zw/Interface/CheckPayment/?guid=' || _j)
    returning id into _p;
    perform tests.as_service();
    perform public.apply_paynow_result(_p, 'ipn', 'Paid', '300.00', _p::text);
  end if;
  perform tests.as_owner();
  return _j;
end $$;

create or replace function pg_temp.release(_j uuid) returns void language plpgsql as $$
begin
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform tests.complete(_j);
  perform tests.as_owner();
end $$;

create or replace function pg_temp.payout(_j uuid) returns public.driver_payouts language sql as $$
  select * from public.driver_payouts where job_id = _j
$$;

-- A. Payout number -----------------------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
select is(public.set_payout_ecocash_number('0771 111 111'), 'ok', 'A: a driver sets an EcoCash payout number');
select tests.as_owner();
select is((select payout_ecocash_number from public.driver_profiles where user_id = current_setting('t.drv')::uuid),
          '771111111', 'A: stored in the 9-digit form');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$select public.set_payout_ecocash_number('12345')$$, 'P0001', null, 'A: an invalid number is refused');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.set_payout_ecocash_number('0771111111')$$, '42501', null, 'A: customers have no payout number');
select tests.as_owner();
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.drv')::uuid
                 and title = 'Payout number changed'), 'A: the driver is told the number changed');

-- With a withdrawal PIN set, changing the number needs it.
update public.driver_profiles set withdrawal_pin_hash = extensions.crypt('4321', extensions.gen_salt('bf'))
 where user_id = current_setting('t.drv')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
select is(public.set_payout_ecocash_number('0772 111 112', '0000'), 'wrong_pin', 'A: wrong PIN is refused');
select tests.as_owner();
select is((select payout_ecocash_number from public.driver_profiles where user_id = current_setting('t.drv')::uuid),
          '771111111', 'A: ... and the number is unchanged');
select is((select fail_count from public.pin_attempts where user_id = current_setting('t.drv')::uuid), 1,
          'A: ... and the wrong attempt counts towards the lockout');
select tests.login_as(current_setting('t.drv')::uuid);
select is(public.set_payout_ecocash_number('0771 111 111', '4321'), 'ok', 'A: right PIN (same number) is fine');
select tests.as_owner();
update public.driver_profiles set withdrawal_pin_hash = null where user_id = current_setting('t.drv')::uuid;

-- B. Release of a Payonify Con Z Pay job creates a payout and moves the money out of the wallet ------
select set_config('t.j1', pg_temp.paid_job(current_setting('t.drv')::uuid)::text, true);
select pg_temp.release(current_setting('t.j1')::uuid);
select is((select status from public.jobs where id = current_setting('t.j1')::uuid), 'completed', 'B: job completed');
select is((pg_temp.payout(current_setting('t.j1')::uuid)).status, 'queued', 'B: a payout is queued');
select is((pg_temp.payout(current_setting('t.j1')::uuid)).amount, 279.00::numeric(12,2), 'B: payout = $300 minus 7% commission');
select is((pg_temp.payout(current_setting('t.j1')::uuid)).commission, 21.00::numeric(12,2), 'B: commission recorded');
select is((pg_temp.payout(current_setting('t.j1')::uuid)).ecocash_number, '771111111', 'B: to the driver''s number');
select is((pg_temp.payout(current_setting('t.j1')::uuid)).livemode, false, 'B: test mode, like the payment');
select is(tests.balance(current_setting('t.drv')::uuid), 0::numeric, 'B: wallet credited then debited: back to $0');
select ok(tests.ledger_matches(current_setting('t.drv')::uuid), 'B: wallet transactions match the balance');
select is((select count(*)::int from public.platform_ledger where kind = 'withdrawal_paid'
             and job_id = current_setting('t.j1')::uuid), 2, 'B: ledger records the payout (balanced pair)');

-- C. Server-only sending functions ---------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$select * from public.payout_claim_next(10, false)$$, '42501', null, 'C: a driver cannot claim payouts');
select throws_ok(format($$select public.payout_record_result(%L, 'succeeded')$$,
                 (select id from public.driver_payouts where job_id = current_setting('t.j1')::uuid)),
                 '42501', null, 'C: a driver cannot mark a payout paid');
select tests.as_service();
select is((select count(*)::int from public.payout_claim_next(10, true)), 0, 'C: live-mode claim ignores test payouts');
select is((select status from public.payout_claim_next(10, false) limit 1), 'sending', 'C: the server claims it for sending');
select is((select count(*)::int from public.payout_claim_next(10, false)), 0, 'C: a claimed payout is not claimed twice at once');
select is((public.payout_record_sent((pg_temp.payout(current_setting('t.j1')::uuid)).id, 'tr_one', 279)).status, 'sent',
          'C: Payonify accepted it');
select is((public.payout_record_result((pg_temp.payout(current_setting('t.j1')::uuid)).id, 'succeeded', 'tr_one')).status,
          'succeeded', 'C: the transfer succeeded');
select is((public.payout_record_result((pg_temp.payout(current_setting('t.j1')::uuid)).id, 'failed', 'tr_one')).status,
          'succeeded', 'C: a late failure report cannot undo a succeeded payout');
select tests.as_owner();
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.drv')::uuid
                 and title = 'Payment sent to your EcoCash'), 'C: the driver is told it was sent');

-- D. A definitive failure returns the money to the wallet --------------------------------------------
select set_config('t.j2', pg_temp.paid_job(current_setting('t.drv')::uuid)::text, true);
select pg_temp.release(current_setting('t.j2')::uuid);
select tests.as_service();
select public.payout_claim_next(10, false);
select is((public.payout_record_result((pg_temp.payout(current_setting('t.j2')::uuid)).id, 'failed', null,
           'recipient_not_found', 'Number not registered')).status, 'returned', 'D: a failed payout is returned');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 279::numeric, 'D: the money is back in the wallet');
select ok(tests.ledger_matches(current_setting('t.drv')::uuid), 'D: wallet transactions still match');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.drv')::uuid
                 and title like 'Payout not sent%'), 'D: the driver is told');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.admin')::uuid
                 and title = 'Automatic payout failed'), 'D: admins are told');
select tests.as_service();
select is((public.payout_record_result((pg_temp.payout(current_setting('t.j2')::uuid)).id, 'failed')).status, 'returned',
          'D: a repeated failure report changes nothing');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 279::numeric, 'D: ... the money is not returned twice');

-- E. "Funds not settled yet" waits and retries; a sent transfer can't be "retried" ---------------------
select set_config('t.j3', pg_temp.paid_job(current_setting('t.drv')::uuid)::text, true);
select pg_temp.release(current_setting('t.j3')::uuid);
select tests.as_service();
select public.payout_claim_next(10, false);
select is((public.payout_record_result((pg_temp.payout(current_setting('t.j3')::uuid)).id, 'retry_later', null,
           'insufficient_funds', 'Funds not available yet', 30)).status, 'queued', 'E: insufficient funds goes back to queued');
select ok((pg_temp.payout(current_setting('t.j3')::uuid)).next_attempt_at > now() + interval '25 minutes',
          'E: ... with a later retry time');
select is((select count(*)::int from public.payout_claim_next(10, false)), 0, 'E: ... and is not claimed before then');
select tests.as_owner();
update public.driver_payouts set next_attempt_at = now() - interval '1 minute' where job_id = current_setting('t.j3')::uuid;
select tests.as_service();
select public.payout_claim_next(10, false);
select public.payout_record_sent((pg_temp.payout(current_setting('t.j3')::uuid)).id, 'tr_three');
select throws_ok(format($$select public.payout_record_result(%L, 'retry_later')$$, (pg_temp.payout(current_setting('t.j3')::uuid)).id),
                 'P0001', null, 'E: a transfer Payonify accepted is never sent again');

-- F. No number yet: the money waits in the wallet until the driver adds one -------------------------
select set_config('t.j4', pg_temp.paid_job(current_setting('t.drv2')::uuid)::text, true);
select pg_temp.release(current_setting('t.j4')::uuid);
select is((pg_temp.payout(current_setting('t.j4')::uuid)).status, 'waiting_for_number', 'F: no number: payout waits');
select is(tests.balance(current_setting('t.drv2')::uuid), 279::numeric, 'F: ... and the money stays in the wallet');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.drv2')::uuid
                 and title = 'Add your EcoCash number to get paid'), 'F: the driver is asked for a number');
select tests.login_as(current_setting('t.drv2')::uuid);
select length(public.set_payout_ecocash_number('0772111112')) as set_number;
select tests.as_owner();
select is((pg_temp.payout(current_setting('t.j4')::uuid)).status, 'queued', 'F: adding a number queues it');
select is(tests.balance(current_setting('t.drv2')::uuid), 0::numeric, 'F: ... and moves the money out of the wallet');

-- G. Paynow Con Z Pay is unchanged (money stays in the wallet) ---------------------------------------
select set_config('t.j5', pg_temp.paid_job(current_setting('t.drv2')::uuid, 'paynow')::text, true);
select pg_temp.release(current_setting('t.j5')::uuid);
select is((select count(*)::int from public.driver_payouts where job_id = current_setting('t.j5')::uuid), 0,
          'G: a Paynow-paid job creates no automatic payout');

-- H. Who can see payouts ------------------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.driver_payouts), 3, 'H: a driver sees their own payouts');
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.driver_payouts where driver_id = current_setting('t.drv')::uuid), 0,
          'H: ... and not another driver''s');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.driver_payouts), 0, 'H: customers see none');
select throws_ok($$update public.driver_payouts set status = 'succeeded'$$, '42501', null, 'H: nobody writes payouts from the app');

-- I. Sending a returned payout again: super admin with a fresh sign-in, and a reason ------------------
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_retry_payout(%L, 'driver fixed number')$$, (pg_temp.payout(current_setting('t.j2')::uuid)).id),
                 '42501', null, 'I: an ordinary admin cannot resend a payout');
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select is((public.admin_retry_payout((pg_temp.payout(current_setting('t.j2')::uuid)).id, 'driver fixed number')).status, 'queued',
          'I: a super admin can send a returned payout again');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 0::numeric, 'I: ... which takes it out of the wallet again');
select ok(tests.ledger_matches(current_setting('t.drv')::uuid), 'I: wallet transactions still match');

select * from finish();
rollback;
