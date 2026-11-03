-- 0134: $20 one-time promotional commission credit: non-cash, non-withdrawable, used first for commission,
-- returned to the promo bucket (never cash) when a reservation is released, granted once, off by default.
begin;
select plan(29);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('pc_cust')::text, true);
select set_config('t.d1', tests.create_driver('pc_d1', 0)::text, true);    -- no cash, will have promo
select set_config('t.d2', tests.create_driver('pc_d2', 10)::text, true);   -- $10 cash + promo
select set_config('t.d3', tests.create_driver('pc_d3', 0)::text, true);    -- too little promo
select set_config('t.new', tests.create_user('pc_new')::text, true);
select set_config('t.admin', tests.create_user('pc_admin', array['admin'])::text, true);

-- 1. Off by default: verification grants nothing
select is((select value #>> '{}' from public.system_settings where key = 'promo_credit_enabled'), 'false', 'the promotional credit is off by default');
select tests.as_owner();
insert into public.driver_profiles (user_id, verification_status) values (current_setting('t.new')::uuid, 'pending');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.new')::uuid;
select is((select count(*)::int from public.promo_credit_ledger where user_id = current_setting('t.new')::uuid), 0, 'no credit is granted while it is off');

-- 2. On: a newly verified driver gets $20 once
update public.system_settings set value = 'true'::jsonb where key = 'promo_credit_enabled';
select set_config('t.new2', tests.create_user('pc_new2')::text, true);
insert into public.driver_profiles (user_id, verification_status) values (current_setting('t.new2')::uuid, 'pending');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.new2')::uuid;
select is((select promo_balance from public.wallets where user_id = current_setting('t.new2')::uuid), 20.00::numeric, 'a newly verified driver receives $20');
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.new2')::uuid;
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.new2')::uuid;
select is((select promo_balance from public.wallets where user_id = current_setting('t.new2')::uuid), 20.00::numeric, 'verifying again does not grant it twice');
select is((select balance from public.wallets where user_id = current_setting('t.new2')::uuid), 0.00::numeric, 'the credit is not cash');

-- 3. Promo is used first for the commission; cash stays cash
update public.wallets set promo_balance = 20 where user_id in (current_setting('t.d1')::uuid, current_setting('t.d2')::uuid);
insert into public.promo_credit_ledger (user_id, amount, kind) values (current_setting('t.d1')::uuid, 20, 'grant'), (current_setting('t.d2')::uuid, 20, 'grant');
select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);   -- commission $14
select set_config('t.b1', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.d1')::uuid, 200)::text, true);
select tests.login_as(current_setting('t.d1')::uuid);
select is((public.driver_can_accept(current_setting('t.j1')::uuid) ->> 'ok')::boolean, true, 'a driver with only promo credit can cover the commission');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.b1')), 'the customer selects the driver; the reservation succeeds');
select tests.as_owner();
select ok((select promo_balance = 6 and balance = 14 and held = 14 from public.wallets where user_id = current_setting('t.d1')::uuid),
  'promo $14 reserved (promo 6 left); it sits in balance only as reserved funds');
select is(public.wallet_available(current_setting('t.d1')::uuid), 0::numeric, 'nothing is withdrawable while reserved');
select is((select held_commission_promo from public.jobs where id = current_setting('t.j1')::uuid), 14.00::numeric, 'the job records how much of the reservation was promo');

-- 4. Releasing the reservation returns promo to the promo bucket, not to cash
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.cancel_job(%L, 'changed my mind')$$, current_setting('t.j1')), 'the job is cancelled');
select tests.as_owner();
select ok((select promo_balance = 20 and balance = 0 and held = 0 from public.wallets where user_id = current_setting('t.d1')::uuid),
  'promo back to $20, cash still $0, nothing held');
select is(public.release_job_commission(current_setting('t.j1')::uuid), 0::numeric, 'a second release does nothing');
select is((select promo_balance from public.wallets where user_id = current_setting('t.d1')::uuid), 20.00::numeric, '... and returns nothing twice');

-- 5. Mixed: promo first, cash untouched and still withdrawable
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select set_config('t.b2', tests.create_bid(current_setting('t.j2')::uuid, current_setting('t.d2')::uuid, 200)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b2')::uuid);
select tests.as_owner();
select ok((select promo_balance = 6 and balance = 24 and held = 14 from public.wallets where user_id = current_setting('t.d2')::uuid),
  'promo spent first: $14 of promo reserved, the driver''s own $10 untouched');
select is(public.wallet_available(current_setting('t.d2')::uuid), 10::numeric, 'the driver''s own $10 stays available (withdrawable)');
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j2')::uuid);
select tests.as_owner();
select is((select balance from public.wallets where user_id = current_setting('t.d2')::uuid), 10.00::numeric, 'after verified delivery the cash is $10 (the reserve paid the commission)');
select is((select held from public.wallets where user_id = current_setting('t.d2')::uuid), 0.00::numeric, '... nothing is held');
select is((select promo_balance from public.wallets where user_id = current_setting('t.d2')::uuid), 6.00::numeric, '... and $6 of promo credit remains');
select is((select sum(amount) from public.platform_ledger where job_id = current_setting('t.j2')::uuid and account = 'platform_revenue'), -14::numeric,
  'ConZ earns the full $14 commission');

-- 6. Too little promo and no cash: exact shortfall, nothing changes
update public.wallets set promo_balance = 5 where user_id = current_setting('t.d3')::uuid;
insert into public.promo_credit_ledger (user_id, amount, kind) values (current_setting('t.d3')::uuid, 5, 'grant');
select set_config('t.j3', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select set_config('t.b3', tests.create_bid(current_setting('t.j3')::uuid, current_setting('t.d3')::uuid, 200)::text, true);
select tests.login_as(current_setting('t.d3')::uuid);
select is((public.driver_can_accept(current_setting('t.j3')::uuid) ->> 'shortfall')::numeric, 9::numeric, 'the shortfall is exact: $14 needed, $5 available');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.b3')), null, null, 'selection is refused');
select tests.as_owner();
select is((select promo_balance from public.wallets where user_id = current_setting('t.d3')::uuid), 5.00::numeric, 'and the promo balance is untouched');

-- 7. Not writable or transferable by clients
select tests.login_as(current_setting('t.d1')::uuid);
select throws_ok($$update public.wallets set promo_balance = 999 where user_id = auth.uid()$$, '42501', null, 'a driver cannot edit the promo balance');
select throws_ok($$insert into public.promo_credit_ledger (user_id, amount, kind) values (auth.uid(), 20, 'grant')$$, '42501', null, 'nor write the promo ledger');
select throws_ok($$select public.grant_promo_credit(auth.uid())$$, '42501', null, 'nor grant themselves credit');
select is((select count(*)::int from public.promo_credit_ledger where user_id <> auth.uid()), 0, 'and cannot read other drivers'' credit');

-- 8. The books reconcile
select tests.login_as(current_setting('t.admin')::uuid);
select ok(not exists (select 1 from public.promo_credit_reconciliation() r where not r.ok), 'promo balances equal their ledger and open reservations');
select tests.as_owner();
select is((select value #>> '{}' from public.system_settings where key = 'commission_rate'), '7', 'the 7% commission is untouched');

select * from finish();
rollback;
