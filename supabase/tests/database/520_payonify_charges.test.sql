-- 0120 — Payonify (Relay) charges: one guarded entry point, event de-duplication,
-- charge/payment binding, test/live separation, no state regression, and Paynow untouched.

begin;
select plan(68);
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 100)::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);

-- An accepted escrow job with a $300 Payonify payment (test mode). Payment id -> t.p_<name>.
create or replace function pg_temp.payonify_job(_name text, _livemode boolean default false)
returns uuid language plpgsql as $$
declare _j uuid; _p uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow');
  update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 300
   where id = _j;
  insert into public.payments (user_id, job_id, type, amount, currency, method, status, provider, provider_livemode)
  values (current_setting('t.cust')::uuid, _j, 'escrow', 300, 'USD', 'payonify', 'initiated', 'payonify', _livemode)
  returning id into _p;
  perform set_config('t.p_' || _name, _p::text, true);
  perform set_config('t.j_' || _name, _j::text, true);
  return _j;
end $$;

-- apply_payonify_charge as service_role, returning the outcome.
create or replace function pg_temp.apply(_name text, _event text, _charge text, _status text,
  _amount bigint default 30000, _currency text default 'usd', _livemode boolean default false,
  _meta text default null, _source text default 'ipn')
returns text language plpgsql as $$
declare _r jsonb;
begin
  perform tests.as_service();
  _r := public.apply_payonify_charge(current_setting('t.p_' || _name)::uuid, _source, _event, _charge, _status,
          _amount, _currency, _livemode, coalesce(_meta, current_setting('t.p_' || _name)));
  perform tests.as_owner();
  return _r->>'outcome';
end $$;

create or replace function pg_temp.pstatus(_name text) returns text language sql as $$
  select status from public.payments where id = current_setting('t.p_' || _name)::uuid
$$;

create or replace function pg_temp.anomalies() returns int language sql as $$
  select count(*)::int from public.notifications
   where user_id = current_setting('t.admin')::uuid and type = 'payment_anomaly'
$$;

-- ===========================================================================
-- A. Schema: Paynow rows unchanged; provider fields guarded
-- ===========================================================================
select tests.as_owner();
insert into public.payments (user_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, 'topup', 20, 'USD', 'paynow', 'initiated');
select is((select provider from public.payments where method = 'paynow' limit 1), 'paynow',
  'A: existing/new Paynow payments default to provider paynow');
select throws_ok($$insert into public.payments (user_id, type, amount, currency, method, status, provider)
  values (current_setting('t.cust')::uuid, 'escrow', 20, 'USD', 'payonify', 'initiated', 'payonify')$$,
  '23514', null, 'A: a Payonify payment must record test or live mode');
select throws_ok($$insert into public.payments (user_id, type, amount, currency, method, status, provider, provider_livemode)
  values (current_setting('t.cust')::uuid, 'withdrawal', 20, 'USD', 'payonify', 'initiated', 'payonify', false)$$,
  '23514', null, 'A: Payonify takes Con Z Pay and top-ups only (not withdrawals)');
select throws_ok($$insert into public.payments (user_id, type, amount, currency, method, status, provider)
  values (current_setting('t.cust')::uuid, 'escrow', 20, 'USD', 'x', 'initiated', 'stripe')$$,
  '23514', null, 'A: unknown providers are refused');

select pg_temp.payonify_job('a');
select throws_ok(format($$insert into public.payments (user_id, job_id, type, amount, currency, method, status, provider, provider_livemode)
  values (current_setting('t.cust')::uuid, %L, 'escrow', 300, 'USD', 'payonify', 'initiated', 'payonify', false)$$, current_setting('t.j_a')),
  '23505', null, 'A: only one open Payonify attempt per job');
select throws_ok(format($$update public.payments set provider = 'paynow' where id = %L$$, current_setting('t.p_a')),
  '42501', null, 'A: provider cannot be changed');
select throws_ok(format($$update public.payments set provider_livemode = true where id = %L$$, current_setting('t.p_a')),
  '42501', null, 'A: test/live mode cannot be changed');

-- ===========================================================================
-- B. Client access
-- ===========================================================================
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.apply_payonify_charge(%L, 'ipn', 'evt_x', 'ch_x', 'succeeded', 30000, 'usd', false, %L)$$,
  current_setting('t.p_a'), current_setting('t.p_a')), '42501', null, 'B: clients cannot call apply_payonify_charge');
select throws_ok($$select public.record_payonify_event('evt_x', 'charge.succeeded', null, null, false, null)$$,
  '42501', null, 'B: clients cannot call record_payonify_event');
select is((select provider from public.payments where id = current_setting('t.p_a')::uuid), 'payonify',
  'B: customers can see which service took their payment');
select throws_ok($$select provider_reference from public.payments$$, '42501', null,
  'B: the Payonify charge id stays server-side');

-- ===========================================================================
-- C. Pending, then success: marks the escrow payment paid exactly once
-- ===========================================================================
select is(pg_temp.apply('a', null, 'ch_a', 'pending', _source => 'initiate'), 'pending_no_change', 'C: pending leaves the payment initiated');
select is((select provider_reference from public.payments where id = current_setting('t.p_a')::uuid), 'ch_a',
  'C: the charge id is recorded on first sight');
select is(pg_temp.apply('a', 'evt_a1', 'ch_a', 'requires_authorization'), 'pending_no_change', 'C: awaiting customer approval is still pending');
select is(pg_temp.pstatus('a'), 'initiated', 'C: still initiated');

select is(pg_temp.apply('a', 'evt_a2', 'ch_a', 'succeeded'), 'escrow_marked_paid', 'C: succeeded marks the escrow payment paid');
select is(pg_temp.pstatus('a'), 'paid', 'C: payment is paid (held)');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.drv')::uuid and type = 'escrow_funded'
  and job_id = current_setting('t.j_a')::uuid), 'C: driver told the payment is held');
select is(tests.balance(current_setting('t.drv')::uuid), 100.00::numeric, 'C: nothing reaches the driver before delivery');

select is(pg_temp.apply('a', 'evt_a2', 'ch_a', 'succeeded'), 'duplicate_event', 'C: the same webhook event again is ignored');
select is((select count(*)::int from public.payment_events where provider_event_id = 'evt_a2'), 1, 'C: the event is recorded once');
select is(pg_temp.apply('a', null, 'ch_a', 'succeeded', _source => 'poll'), 'duplicate_ignored', 'C: a later status check is a no-op');
select is((select count(*)::int from public.platform_ledger
            where payment_id = current_setting('t.p_a')::uuid and kind = 'escrow_paid' and account = 'escrow_held'), 1,
  'C: the escrow hold is posted to the ledger once');

-- Out of order: a failure that arrives after the success never moves it back.
select set_config('t.n0', pg_temp.anomalies()::text, true);
select is(pg_temp.apply('a', 'evt_a3', 'ch_a', 'failed'), 'regression_blocked', 'C: failed after succeeded is blocked');
select is(pg_temp.pstatus('a'), 'paid', 'C: payment stays paid');
select ok(pg_temp.anomalies() > current_setting('t.n0')::int, 'C: admins alerted to the contradiction');

-- ===========================================================================
-- D. Mismatches change nothing and alert admins
-- ===========================================================================
select pg_temp.payonify_job('d');
select set_config('t.n1', pg_temp.anomalies()::text, true);
select is(pg_temp.apply('d', 'evt_d1', 'ch_d', 'succeeded', _amount => 100), 'rejected_amount_mismatch', 'D: underpaid charge rejected');
select is(pg_temp.apply('d', 'evt_d2', 'ch_d', 'succeeded', _currency => 'zwg'), 'rejected_currency_mismatch', 'D: wrong currency rejected');
select is(pg_temp.apply('d', 'evt_d3', 'ch_d', 'succeeded', _livemode => true), 'rejected_mode_mismatch', 'D: a live charge cannot pay a test payment');
select is(pg_temp.apply('d', 'evt_d4', 'ch_d', 'succeeded', _meta => gen_random_uuid()::text), 'rejected_reference_mismatch',
  'D: a charge made for another payment is rejected');
select is(pg_temp.apply('d', 'evt_d5', 'ch_d', 'succeeded'), 'escrow_marked_paid',
  'D: the matching charge then pays it');
select is(pg_temp.apply('d', 'evt_d6', 'ch_other', 'succeeded'), 'rejected_reference_mismatch',
  'D: once bound, a different charge id is rejected');
select pg_temp.payonify_job('h');
select throws_ok($$select pg_temp.apply('h', 'evt_h1', 'ch_a', 'pending')$$, '23505', null,
  'D: one charge id can never be bound to two payments');
select ok(pg_temp.anomalies() >= current_setting('t.n1')::int + 4, 'D: admins alerted for each mismatch');
select is((select count(*)::int from public.payment_events where payment_id = current_setting('t.p_d')::uuid and provider = 'payonify'), 6,
  'D: every attempt is in the audit trail');

-- ===========================================================================
-- E. Failure, cancellation, late success, unknown status
-- ===========================================================================
select pg_temp.payonify_job('e');
select is(pg_temp.apply('e', 'evt_e1', 'ch_e', 'failed'), 'closed_unpaid', 'E: failed closes an unpaid payment');
select is(pg_temp.pstatus('e'), 'failed', 'E: status failed');
select set_config('t.n2', pg_temp.anomalies()::text, true);
select is(pg_temp.apply('e', 'evt_e2', 'ch_e', 'succeeded'), 'late_success_flagged', 'E: success after failure is flagged, not applied');
select is(pg_temp.pstatus('e'), 'failed', 'E: status stays failed');
select ok(pg_temp.anomalies() > current_setting('t.n2')::int, 'E: admins alerted to check and refund/apply manually');

select pg_temp.payonify_job('f');
select is(pg_temp.apply('f', 'evt_f1', 'ch_f', 'cancelled'), 'closed_unpaid', 'E: cancelled closes an unpaid payment');
select is(pg_temp.pstatus('f'), 'cancelled', 'E: status cancelled');

select pg_temp.payonify_job('g');
select is(pg_temp.apply('g', 'evt_g1', 'ch_g', 'mystery'), 'unknown_status_ignored', 'E: an undocumented status changes nothing');
select is(pg_temp.pstatus('g'), 'initiated', 'E: still initiated');

-- ===========================================================================
-- F. Paynow rows are not Payonify's to change; Paynow expiry leaves Payonify alone
-- ===========================================================================
select tests.as_owner();
select set_config('t.p_pn', (select id::text from public.payments where method = 'paynow' limit 1), true);
select is(pg_temp.apply('pn', 'evt_pn', 'ch_pn', 'succeeded', _amount => 2000), 'rejected_wrong_provider',
  'F: a Paynow payment cannot be changed by a Payonify result');

-- Both rows "older than an hour" with no Paynow poll URL.
insert into public.payments (user_id, type, amount, currency, method, status, created_at)
values (current_setting('t.cust')::uuid, 'topup', 15, 'USD', 'paynow', 'initiated', now() - interval '2 hours');
select set_config('t.jold', tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow')::text, true);
insert into public.payments (user_id, job_id, type, amount, currency, method, status, provider, provider_livemode, created_at)
values (current_setting('t.cust')::uuid, current_setting('t.jold')::uuid, 'escrow', 300, 'USD', 'payonify', 'initiated',
        'payonify', false, now() - interval '2 hours');
select tests.as_service();
select public.expire_unsent_paynow_payments();
select tests.as_owner();
select is((select status from public.payments where provider = 'paynow' and amount = 15), 'cancelled',
  'F: Paynow expiry still closes Paynow payments that never reached Paynow');
select is((select status from public.payments where provider = 'payonify' and job_id = current_setting('t.jold')::uuid), 'initiated',
  'F: Paynow expiry does not cancel a Payonify payment awaiting approval');

-- ===========================================================================
-- G. Unhandled event types are recorded once
-- ===========================================================================
select tests.as_service();
select is(public.record_payonify_event('evt_t1', 'transfer.succeeded', 'tr_1', null, false, null)->>'outcome', 'recorded_unhandled',
  'G: an event ConZ does not act on is recorded');
select is(public.record_payonify_event('evt_t1', 'transfer.succeeded', 'tr_1', null, false, null)->>'outcome', 'duplicate_event',
  'G: and only once');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.payonify_webhook_events), 0, 'G: customers cannot read webhook events');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*)::int from public.payonify_webhook_events), 1, 'G: admins can');
select tests.as_owner();

-- ===========================================================================
-- H. Driver wallet top-up through Payonify
-- ===========================================================================
select tests.as_owner();
select set_config('t.wb0', tests.balance(current_setting('t.drv')::uuid)::text, true);
insert into public.payments (user_id, type, amount, currency, method, status, provider, provider_livemode)
values (current_setting('t.drv')::uuid, 'topup', 10, 'USD', 'payonify', 'initiated', 'payonify', false);
select set_config('t.p_t', (select id::text from public.payments where user_id = current_setting('t.drv')::uuid
  and provider = 'payonify' and type = 'topup'), true);
select throws_ok($$insert into public.payments (user_id, type, amount, currency, method, status, provider, provider_livemode)
  values (current_setting('t.drv')::uuid, 'topup', 5, 'USD', 'payonify', 'initiated', 'payonify', false)$$,
  '23505', null, 'H: only one open Payonify top-up per user');
select is(pg_temp.apply('t', 'evt_t2', 'ch_t', 'succeeded', _amount => 1000), 'credited', 'H: a succeeded top-up credits the wallet');
select is(tests.balance(current_setting('t.drv')::uuid), current_setting('t.wb0')::numeric + 10, 'H: wallet up by exactly $10');
select is(pg_temp.apply('t', 'evt_t3', 'ch_t', 'succeeded', _amount => 1000), 'duplicate_ignored', 'H: a repeat does not credit twice');
select is(tests.balance(current_setting('t.drv')::uuid), current_setting('t.wb0')::numeric + 10, 'H: still +$10');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.drv')::uuid
  and type = 'wallet_topup' and body like '%via EcoCash%'), 'H: the driver is told it came via EcoCash');
select ok(exists(select 1 from public.wallet_transactions where user_id = current_setting('t.drv')::uuid
  and note like 'EcoCash top-up (ref ch_t)%'), 'H: wallet history names EcoCash and the charge');

-- ===========================================================================
-- I. The payment switch
-- ===========================================================================
select set_config('t.sup', tests.create_user('pp_sup', array['admin','super_admin'])::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select is(public.launch_switches()->>'paymentProvider', 'paynow', 'I: Paynow is the default');
select throws_like($$select public.admin_set_payment_provider('payonify', 'going live')$$, '%Only super admins%',
  'I: a customer cannot switch');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like($$select public.admin_set_payment_provider('payonify', 'going live')$$, '%Only super admins%',
  'I: a plain admin cannot switch');
select tests.login_as(current_setting('t.sup')::uuid);
select throws_like($$select public.admin_set_payment_provider('payonify', 'going live')$$, '%MFA_REQUIRED%',
  'I: a super admin needs a fresh step-up');
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select throws_like($$select public.admin_set_payment_provider('stripe', 'going live')$$, '%paynow or payonify%',
  'I: only the two providers');
select throws_like($$select public.admin_set_payment_provider('payonify', 'x')$$, '%reason%', 'I: a reason is required');
select is(public.admin_set_payment_provider('payonify', 'live test passed'), 'payonify', 'I: super admin with step-up switches');
select is(public.launch_switches()->>'paymentProvider', 'payonify', 'I: the app sees the switch');
select tests.as_owner();
select ok(exists(select 1 from public.admin_audit_log where action = 'payment_provider_changed'
  and meta->>'from' = 'paynow' and meta->>'to' = 'payonify'), 'I: the switch is audit-logged');
update public.system_settings set value = '"nonsense"'::jsonb where key = 'payment_provider';
select tests.login_as(current_setting('t.cust')::uuid);
select is(public.launch_switches()->>'paymentProvider', 'paynow', 'I: an unreadable setting falls back to Paynow');
select tests.as_owner();

select * from finish();
rollback;
