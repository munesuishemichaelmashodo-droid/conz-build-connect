-- 0107 — MVP launch switches: escrow off, withdrawals off, job/bid cap, wallet cap, minimum top-up.
-- All enforced by the database (triggers), with the defaults the owner approved on 2026-10-13.
begin;
select plan(20);

select set_config('t.cust', tests.create_user('ls_cust')::text, true);
select set_config('t.drv',  tests.create_driver('ls_drv', 100, true)::text, true);
select tests.as_owner();

-- Defaults
select is((public.launch_switches())->>'escrowEnabled', 'false', '1: escrow is off by default');
select is((public.launch_switches())->>'withdrawalsEnabled', 'false', '2: withdrawals are off by default');
select is((public.launch_switches())->>'maxJobBudget', '500', '3: default job cap is 500');
select is((public.launch_switches())->>'maxWalletBalance', '150', '4: default wallet cap is 150');

-- Jobs
select lives_ok(format('select tests.create_job(%L, 400, ''direct'')', current_setting('t.cust')), '5: a direct-pay job within the cap is created');
select throws_like(format('select tests.create_job(%L, 400, ''escrow'')', current_setting('t.cust')), '%Con Z Pay is not available yet%', '6: an escrow job is refused while escrow is off');
select throws_like(format('select tests.create_job(%L, 501, ''direct'')', current_setting('t.cust')), '%maximum amount for a job%', '7: a job above the cap is refused');

-- Bids
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select lives_ok(format('select tests.create_bid(%L, %L, 400)', current_setting('t.job'), current_setting('t.drv')), '8: a bid within the cap is accepted');
select throws_like(format('select tests.create_bid(%L, %L, 501)', current_setting('t.job'), current_setting('t.drv')), '%maximum amount for a job%', '9: a bid above the cap is refused');

-- Withdrawals
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok($$select public.set_withdrawal_pin('4826', null)$$, 'setup: driver sets a PIN');
select throws_like($$select public.request_withdrawal(10, 'ecocash', '0771234567', '4826')$$, '%Withdrawals are paused%', '10: a withdrawal request is refused while paused');
select tests.as_owner();
select is((select count(*)::int from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid), 0, '11: no withdrawal row was created');

-- Top-ups: minimum and wallet cap (driver wallet starts at 100)
select throws_like(format($$insert into public.payments(user_id, type, amount, currency, method, status) values (%L, 'topup', 0.5, 'USD', 'paynow', 'initiated')$$, current_setting('t.drv')), '%smallest top-up%', '12: a top-up below the minimum is refused');
select throws_like(format($$insert into public.payments(user_id, type, amount, currency, method, status) values (%L, 'topup', 60, 'USD', 'paynow', 'initiated')$$, current_setting('t.drv')), '%can hold at most%', '13: a top-up that would pass the wallet cap is refused');
select lives_ok(format($$insert into public.payments(user_id, type, amount, currency, method, status) values (%L, 'topup', 50, 'USD', 'paynow', 'initiated')$$, current_setting('t.drv')), '14: a top-up up to the cap is allowed');

-- Switches really switch (owner turns them on, behaviour follows)
update public.system_settings set value = 'true'::jsonb where key = 'escrow_enabled';
update public.system_settings set value = 'true'::jsonb where key = 'withdrawals_enabled';
select lives_ok(format('select tests.create_job(%L, 400, ''escrow'')', current_setting('t.cust')), '15: escrow job allowed once the switch is on');
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '4826'))->>'ok', 'true', '16: withdrawal allowed once the switch is on');
select tests.as_owner();

-- Non-top-up payments are not subject to the top-up limits
select lives_ok(format($$select 1 from public.payments where user_id = %L$$, current_setting('t.drv')), '17: unrelated reads still work');

-- Only the app-facing read function is exposed to signed-in users
select ok(not has_function_privilege('anon', 'public.launch_switches()', 'execute'), '18: anonymous cannot call launch_switches');
select ok(has_function_privilege('authenticated', 'public.launch_switches()', 'execute'), '19: signed-in users can read the switches');

select * from finish();
rollback;
