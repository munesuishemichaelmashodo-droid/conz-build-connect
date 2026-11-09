-- 0134 (corrected): the $20 demo promo credit replaces first-job-free.
--   * finding M4 fixed: promo funds that enter a wallet as reserved commission are on the double-entry ledger, so
--     -sum(user_wallets) = sum(wallets.balance) keeps holding through reserve, release and settlement
--   * activation is ONE controlled step (service role only): switch on, one-time $20 to verified drivers whose
--     free first job was still unused (they lose the free job, so they are made whole), first-job-free retired
--   * new drivers after activation never get a free job
begin;
select plan(18);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('pa_cust')::text, true);
select set_config('t.admin', tests.create_user('pa_admin', array['admin'])::text, true);
select set_config('t.dfree', tests.create_driver('pa_dfree', 0, false)::text, true);  -- free first job still unused
select set_config('t.dused', tests.create_driver('pa_dused', 0, true)::text, true);   -- already used it

-- 1. Before activation
select is((public.launch_switches() ->> 'promoCreditEnabled'), 'false', 'the app is told the promo credit is off before activation');
select is((public.launch_switches() -> 'promoCreditAmount')::numeric, 20::numeric, 'and what the amount will be');

-- 1b. Visitors can read exactly the flag and the amount, nothing else
select tests.as_anon();
select is((public.promo_credit_public() ->> 'enabled'), 'false', 'a visitor can read that the credit is off');
select is((select count(*)::int from jsonb_object_keys(public.promo_credit_public())), 2, 'and only the flag and the amount');
select tests.as_owner();

-- 2. Clients cannot activate it
select tests.login_as(current_setting('t.dfree')::uuid);
select throws_ok($$select public.activate_promo_credit_program()$$, '42501', null, 'a driver cannot activate the programme');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok($$select public.activate_promo_credit_program()$$, '42501', null, 'nor can an admin from the app');
select tests.as_owner();

-- 3. The ledger invariant before anything happens: I = sum(balance) + sum(ledger user_wallets), constant
create or replace function pg_temp.invariant() returns numeric language sql as $$
  select coalesce((select sum(balance) from public.wallets), 0)
       + coalesce((select sum(amount) from public.platform_ledger where account = 'user_wallets'), 0)
$$;
select set_config('t.i0', pg_temp.invariant()::text, true);

-- 4. Activation
-- a driver whose login is locked (banned) must not receive credit, even with the free job unused
select set_config('t.dlocked', tests.create_driver('pa_dlocked', 0, false)::text, true);
update auth.users set banned_until = 'infinity'::timestamptz where id = current_setting('t.dlocked')::uuid;

select is((public.activate_promo_credit_program() ->> 'granted')::int, 1, 'activation grants the one eligible driver (free job unused, login not locked)');
select is((select promo_balance from public.wallets where user_id = current_setting('t.dlocked')::uuid), 0.00::numeric, 'a driver whose login is locked gets no credit');
select is((public.launch_switches() ->> 'promoCreditEnabled'), 'true', 'the switch is on');
select is((public.promo_credit_public() ->> 'enabled'), 'true', '... and visitors see it too');
select is((select promo_balance from public.wallets where user_id = current_setting('t.dfree')::uuid), 20.00::numeric, 'that driver now has $20 promo credit');
select is((select balance from public.wallets where user_id = current_setting('t.dfree')::uuid), 0.00::numeric, '... which is not cash');
select ok((select first_job_free_used from public.driver_profiles where user_id = current_setting('t.dfree')::uuid), 'their free first job is retired (replaced by the credit)');
select is((select promo_balance from public.wallets where user_id = current_setting('t.dused')::uuid), 0.00::numeric, 'a driver who already used the free job gets nothing automatically');
select is((public.activate_promo_credit_program() ->> 'granted')::int, 0, 'activating again grants nothing more (one-time)');

-- 5. A driver created after activation never gets a free job
select set_config('t.dnew', tests.create_user('pa_dnew')::text, true);
insert into public.driver_profiles (user_id, verification_status, first_job_free_used) values (current_setting('t.dnew')::uuid, 'pending', false);
select ok((select first_job_free_used from public.driver_profiles where user_id = current_setting('t.dnew')::uuid), 'a new driver profile starts with the free job already retired');

-- 6. Reserve, release and settle keep the ledger and the wallets in step (M4)
select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);   -- commission $14
select set_config('t.b1', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.dfree')::uuid, 200)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b1')::uuid);
select tests.as_owner();
select is(pg_temp.invariant()::text, current_setting('t.i0'), 'M4: reserving promo funds leaves wallets and ledger in step');
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j1')::uuid, 'changed my mind');
select tests.as_owner();
select is(pg_temp.invariant()::text, current_setting('t.i0'), 'M4: releasing the reservation does too');

select * from finish();
rollback;
