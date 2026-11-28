-- 0190: Paynow fails closed. Mode defaults to off; only LIVE credits; a success outside LIVE is recorded, flagged and
-- kept so it can be credited once (never lost, never early); BuySafe "Awaiting Delivery" never credits and is never
-- auto-expired; only a super admin with a step-up and a reason can change the mode. These are simulated results:
-- no real Paynow call is made (the app checks the hash before calling apply_paynow_result).
begin;
select plan(26);

select tests.as_owner();
select set_config('t.user',  tests.create_user('pm_payer')::text, true);
select set_config('t.admin', tests.create_user('pm_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('pm_super', array['super_admin','admin'])::text, true);
update public.system_settings set value = '100000'::jsonb where key = 'max_wallet_balance';
create function pg_temp.pay(_amt numeric) returns uuid language sql as $f$
  insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url, created_at)
  values (current_setting('t.user')::uuid, 'topup', _amt, 'USD', 'paynow', 'initiated',
          'https://www.paynow.co.zw/Interface/CheckPayment/?guid=' || gen_random_uuid(), now() - interval '4 days')
  returning id $f$;
create function pg_temp.apply(_p uuid, _status text, _amt text) returns text language sql as $f$
  select public.apply_paynow_result(_p, 'ipn', _status, _amt, _p::text, 'PN-' || left(_p::text, 6)) ->> 'outcome' $f$;
create function pg_temp.bal() returns numeric language sql as $f$ select balance from public.wallets where user_id = current_setting('t.user')::uuid $f$;
create function pg_temp.st(_p uuid) returns text language sql as $f$ select status from public.payments where id = _p $f$;

-- ============================================================ A. default and modes
delete from public.system_settings where key = 'paynow_mode';
select is(public.paynow_mode(), 'off', '1: with no setting the mode is off');
insert into public.system_settings (key, value) values ('paynow_mode', '"bogus"'::jsonb);
select is(public.paynow_mode(), 'off', '2: an unknown value is treated as off');
update public.system_settings set value = '"test"'::jsonb where key = 'paynow_mode';
select set_config('t.p1', pg_temp.pay(25)::text, true);
select tests.as_service();
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Paid', '25.00'), 'held_mode_not_live', '3: TEST mode: a Paid result is not credited');
select is(pg_temp.bal(), 0.00::numeric, '4: no credit');
select is(pg_temp.st(current_setting('t.p1')::uuid), 'initiated', '5: the payment is kept open, not lost');
select ok(exists (select 1 from public.notifications where type = 'payment_anomaly' and body like '%payment mode is test%'),
          '6: admins are told');
select tests.as_owner();
update public.system_settings set value = '"off"'::jsonb where key = 'paynow_mode';
select tests.as_service();
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Paid', '25.00'), 'held_mode_not_live', '7: OFF mode: still not credited');
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Paid', '99.00'), 'rejected_amount_mismatch', '8: the amount check still comes first');

-- ============================================================ B. LIVE credits once (reconcile after approval)
select tests.as_owner();
update public.system_settings set value = '"live"'::jsonb where key = 'paynow_mode';
select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.p1')::uuid, 'reconcile', 'Paid', '25.00', current_setting('t.p1'), 'PN-1') ->> 'outcome',
          'credited', '9: once LIVE, the held payment is credited by reconcile');
select is(pg_temp.bal(), 25.00::numeric, '10: exactly its amount');
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Paid', '25.00'), 'duplicate_ignored', '11: a repeated result credits nothing more');
select is(pg_temp.bal(), 25.00::numeric, '12: still $25');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.user')::uuid and type = 'topup'), 1,
          '13: one ledger entry');

-- ============================================================ C. BuySafe
select set_config('t.p2', pg_temp.pay(40)::text, true);
select is(pg_temp.apply(current_setting('t.p2')::uuid, 'Awaiting Delivery', '40.00'), 'awaiting_settlement_no_credit',
          '14: Awaiting Delivery (BuySafe) credits nothing');
select ok((select awaiting_settlement_since is not null and status = 'initiated' from public.payments where id = current_setting('t.p2')::uuid),
          '15: it is recorded as held by Paynow');
select is(public.expire_stale_paynow_payment(current_setting('t.p2')::uuid), 'held_by_paynow', '16: a held payment is never auto-expired');
select is(pg_temp.apply(current_setting('t.p2')::uuid, 'Awaiting Delivery', '40.00'), 'awaiting_settlement_no_credit', '17: repeated, still nothing');
select is((select count(*)::int from public.notifications where type = 'payment_anomaly' and body like '%Awaiting Delivery%$40%'
           or (type = 'payment_anomaly' and body like '%$40.00 as Awaiting Delivery%')),
          (select count(distinct user_id)::int from public.user_roles where role in ('admin', 'super_admin')),
          '18: admins are alerted once, not on every repeat');
select is(pg_temp.apply(current_setting('t.p2')::uuid, 'Delivered', '40.00'), 'credited', '19: Delivered credits it once');
select is(pg_temp.bal(), 65.00::numeric, '20: $25 + $40');
select is(pg_temp.apply(current_setting('t.p2')::uuid, 'Refunded', '40.00'), 'reversal_flagged', '21: a later refund is flagged for a human, not silently reversed');

-- ============================================================ D. who can change the mode
select tests.login_as(current_setting('t.user')::uuid);
select is(public.paynow_mode(), 'live', '22: signed-in users can read the mode (it is not secret)');
select throws_ok($$select public.admin_set_paynow_mode('off', 'testing the switch')$$, '42501', null, '23: an ordinary user cannot change it');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok($$select public.admin_set_paynow_mode('off', 'testing the switch')$$, '42501', null, '24: nor an ordinary admin');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_like($$select public.admin_set_paynow_mode('live', 'ok')$$, '%reason%', '25: a super admin must give a reason');
select lives_ok($$select public.admin_set_paynow_mode('off', 'Paused until the company merchant account is verified')$$,
                '26: a super admin with a step-up and a reason switches it off (audited)');

select * from finish();
rollback;
