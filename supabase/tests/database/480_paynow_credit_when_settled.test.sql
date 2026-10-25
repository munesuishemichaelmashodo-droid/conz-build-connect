-- 0116 — a Paynow top-up is credited when Paynow says the money is settled
-- ("Paid" or "Delivered"), not while BuySafe still holds it ("Awaiting Delivery").
-- Messages are modelled as already hash-verified, as in 020.
begin;
select plan(17);
select tests.enable_launch_features();

select set_config('t.user',  tests.create_user('settle_payer')::text, true);
select set_config('t.admin', tests.create_user('settle_ops', array['admin'])::text, true);

create or replace function pg_temp.new_topup(_amount numeric, _age interval default '0'::interval) returns uuid language sql as $$
  insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url, created_at)
  values (current_setting('t.user')::uuid, 'topup', _amount, 'USD', 'paynow', 'initiated',
          'https://www.paynow.co.zw/Interface/CheckPayment/?guid=' || gen_random_uuid(), now() - _age)
  returning id $$;
create or replace function pg_temp.apply(_p uuid, _status text, _amount text) returns jsonb language sql as $$
  select public.apply_paynow_result(_p, 'ipn', _status, _amount, _p::text, 'PN-' || left(_p::text, 6)) $$;

select set_config('t.p1', pg_temp.new_topup(20)::text, true);
select set_config('t.p2', pg_temp.new_topup(30)::text, true);
select set_config('t.p3', pg_temp.new_topup(10, '80 hours')::text, true);
select set_config('t.p4', pg_temp.new_topup(15)::text, true);
select set_config('t.p5', pg_temp.new_topup(5)::text, true);

select tests.as_service();

-- 1. Awaiting Delivery: recorded, not credited
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Awaiting Delivery', '20.00')->>'outcome', 'awaiting_settlement',
  'Awaiting Delivery is recorded as waiting for settlement');
select is(tests.balance(current_setting('t.user')::uuid), 0::numeric, 'No credit while Paynow holds the money');
select is((select status from public.payments where id = current_setting('t.p1')::uuid), 'initiated', 'The payment stays open');
select isnt((select awaiting_settlement_since from public.payments where id = current_setting('t.p1')::uuid), null,
  'It is marked as held by Paynow');
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.admin')::uuid
                    and type = 'payment_anomaly' and body like '%' || current_setting('t.p1') || '%'),
  'Admins are told to confirm delivery in the Paynow portal');
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Awaiting Delivery', '20.00')->>'outcome', 'awaiting_settlement',
  'A repeated Awaiting Delivery changes nothing');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.admin')::uuid
             and body like '%' || current_setting('t.p1') || '%'), 1, 'and does not alert twice');

-- 2. Delivered afterwards: credited exactly once
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Delivered', '20.00')->>'outcome', 'credited', 'Delivered credits the top-up');
select is(tests.balance(current_setting('t.user')::uuid), 20::numeric, 'Wallet credited once');
select is(pg_temp.apply(current_setting('t.p1')::uuid, 'Delivered', '20.00')->>'outcome', 'duplicate_ignored', 'A repeat is ignored');

-- 3. Paid (BuySafe off) still credits straight away
select is(pg_temp.apply(current_setting('t.p2')::uuid, 'Paid', '30.00')->>'outcome', 'credited', 'Paid credits as before');
select is(tests.balance(current_setting('t.user')::uuid), 50::numeric, 'Wallet now 50');

-- 4. Amount checks still come first
select is(pg_temp.apply(current_setting('t.p4')::uuid, 'Awaiting Delivery', '99.00')->>'outcome', 'rejected_amount_mismatch',
  'A wrong amount is still rejected');

-- 5. The 72-hour expiry leaves payments Paynow is holding alone
select is(pg_temp.apply(current_setting('t.p3')::uuid, 'Awaiting Delivery', '10.00')->>'outcome', 'awaiting_settlement',
  'An old top-up reaches Awaiting Delivery');
select is(public.expire_stale_paynow_payment(current_setting('t.p3')::uuid), 'awaiting_settlement',
  'Expiry skips a payment Paynow is holding');
select is((select status from public.payments where id = current_setting('t.p3')::uuid), 'initiated', 'It stays open for Delivered');

-- 6. Owner switch: credit on Awaiting Delivery (the old behaviour)
select tests.as_owner();
insert into public.system_settings (key, value) values ('paynow_credit_on_awaiting_delivery', 'true'::jsonb)
  on conflict (key) do update set value = excluded.value;
select tests.as_service();
select is(pg_temp.apply(current_setting('t.p5')::uuid, 'Awaiting Delivery', '5.00')->>'outcome', 'credited',
  'With the owner switch on, Awaiting Delivery credits as before');

select * from finish();
rollback;
