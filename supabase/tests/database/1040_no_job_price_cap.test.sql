-- 0172: no fixed job/offer ceiling; platform limits, guide ranges and checks stay; large jobs alert admins.
begin;
select plan(12);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('cap_cust')::text, true);
select set_config('t.drv',   tests.create_driver('cap_drv', 1000)::text, true);
select set_config('t.admin', tests.create_user('cap_admin', array['admin'])::text, true);

select ok(not exists (select 1 from public.system_settings where key = 'max_job_budget'), '1: the max_job_budget setting is gone');
select ok(not (public.launch_switches() ? 'maxJobBudget'), '2: launch_switches() no longer reports a ceiling');
select is((public.launch_switches() ->> 'maxWalletBalance'), '150', '3: the commission-credit wallet cap is unchanged');

-- As a real customer: a large job is accepted.
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select tests.create_job(current_setting('t.cust')::uuid, 2500, 'direct')$$, '4: a $2,500 job can be posted');
select throws_ok($$select tests.create_job(current_setting('t.cust')::uuid, 100001, 'direct')$$, '23514', null,
                 '5: the $100,000 platform limit still applies');
select throws_ok($$select tests.create_job(current_setting('t.cust')::uuid, 0, 'direct')$$, '23514', null,
                 '6: a zero budget is still refused');
select throws_like($$select tests.create_job(current_setting('t.cust')::uuid, 600, 'escrow')$$, '%Con Z Pay is not available yet%',
                   '7: escrow stays off');

-- A large offer is accepted; the commission on it is 7%.
select tests.as_owner();
select set_config('t.job', (select id::text from public.jobs where customer_id = current_setting('t.cust')::uuid and budget = 2500), true);
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 2400)::text, true);
select ok(current_setting('t.bid') <> '', '8: a $2,400 offer is accepted');
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 168.00::numeric, '9: 7% of $2,400 is reserved');

-- Large-job alerts: on posting and on agreeing a fare at or above $1,000; nothing below.
select ok((select count(*) from public.notifications where user_id = current_setting('t.admin')::uuid and type = 'large_job'
            and job_id = current_setting('t.job')::uuid) >= 2, '10: admins are told when a large job is posted and agreed');
select tests.login_as(current_setting('t.cust')::uuid);
select tests.create_job(current_setting('t.cust')::uuid, 400, 'direct');
select tests.as_owner();
select is((select count(*)::int from public.notifications n join public.jobs j on j.id = n.job_id
            where n.type = 'large_job' and j.budget = 400 and j.customer_id = current_setting('t.cust')::uuid), 0,
          '11: no alert for an ordinary job');
select is((select value #>> '{}' from public.system_settings where key = 'large_job_alert_amount'), '1000', '12: the alert level is a setting ($1,000)');

select * from finish();
rollback;
