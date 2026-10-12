-- 0104 — supplier-confirmation: initial sourcing never needs it, but the assigned driver (or an admin) can record that
-- the supply for an ACTIVE job has been confirmed. Until then the customer sees "availability not yet confirmed".
-- The record is separate from the job row (no change to the money/guard columns), append-once, and not client-writable.
begin;
select plan(23);

select set_config('t.cust',  tests.create_user('sc_cust')::text, true);
select set_config('t.cust2', tests.create_user('sc_cust2')::text, true);
select set_config('t.drv',   tests.create_driver('sc_drv', 100, true)::text, true);
select set_config('t.drv2',  tests.create_driver('sc_drv2', 100, true)::text, true);
select set_config('t.adm',   tests.create_user('sc_adm', array['admin'])::text, true);

select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 400)::text, true);

-- open job, nobody assigned: nobody but an admin may even try, and not on an open job
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format('select public.confirm_job_supply(%L, ''I know a source'')', current_setting('t.job')), '42501', null, '1: a driver who is not assigned cannot confirm');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format('select public.accept_bid(%L)', current_setting('t.bid')), 'setup: customer accepts the bid');
select throws_ok(format('select public.confirm_job_supply(%L, ''x'')', current_setting('t.job')), '42501', null, '2: the customer cannot confirm supply');
select tests.login_as(current_setting('t.drv2')::uuid);
select throws_ok(format('select public.confirm_job_supply(%L, ''x'')', current_setting('t.job')), '42501', null, '3: an unrelated driver cannot confirm');
select tests.as_anon();
select throws_ok(format('select public.confirm_job_supply(%L, ''x'')', current_setting('t.job')), null, null, '4: anonymous cannot confirm');

-- nothing recorded yet: the customer sees no confirmation
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.job_supply_confirmations where job_id = current_setting('t.job')::uuid), 0, '5: before confirmation there is no record (availability stays "not yet confirmed")');

-- the assigned driver confirms
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.confirm_job_supply(current_setting('t.job')::uuid, 'Loading at Pomona, spoke to the yard'))->>'confirmed', 'true', '6: the assigned driver confirms');
select is((public.confirm_job_supply(current_setting('t.job')::uuid, 'second attempt'))->>'already', 'true', '7: a second confirmation is an idempotent no-op');
select tests.as_owner();
select is((select note from public.job_supply_confirmations where job_id = current_setting('t.job')::uuid), 'Loading at Pomona, spoke to the yard', '8: the first note is kept');
select is((select confirmed_by_role from public.job_supply_confirmations where job_id = current_setting('t.job')::uuid), 'driver', '9: the confirming role is recorded');
select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid and type = 'supply_confirmed' and user_id = current_setting('t.cust')::uuid), 1, '10: the customer is notified exactly once');
select is((select status::text from public.jobs where id = current_setting('t.job')::uuid), 'accepted', '11: confirming does not change the job status');
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 28.00::numeric, '12: nor the 7% commission hold');

-- visibility
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.job_supply_confirmations where job_id = current_setting('t.job')::uuid), 1, '13: the job''s customer can see the confirmation');
select tests.login_as(current_setting('t.cust2')::uuid);
select is((select count(*)::int from public.job_supply_confirmations), 0, '14: another customer cannot');
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.job_supply_confirmations), 0, '15: an unrelated driver cannot');

-- no direct writes
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format('insert into public.job_supply_confirmations (job_id, confirmed_by, confirmed_by_role) values (%L, %L, ''driver'')', current_setting('t.job'), current_setting('t.drv')), '42501', null, '16: clients cannot insert confirmations directly');
select throws_ok(format('update public.job_supply_confirmations set note = ''forged'' where job_id = %L', current_setting('t.job')), '42501', null, '17: clients cannot edit confirmations');
select tests.as_owner();

-- note length bound, admin path, and closed jobs
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid2', tests.create_bid(current_setting('t.job2')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid2')::uuid);
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format('select public.confirm_job_supply(%L, %L)', current_setting('t.job2'), repeat('x', 501)), '%500%', '18: an over-long note is rejected');
select tests.login_as(current_setting('t.adm')::uuid);
select is((public.confirm_job_supply(current_setting('t.job2')::uuid, 'Confirmed by phone with the supplier'))->>'confirmed', 'true', '19: an admin can confirm on the supplier''s behalf');
select tests.as_owner();
select is((select confirmed_by_role from public.job_supply_confirmations where job_id = current_setting('t.job2')::uuid), 'admin', '20: the admin role is recorded');

select set_config('t.job3', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.adm')::uuid);
select throws_like(format('select public.confirm_job_supply(%L, ''x'')', current_setting('t.job3')), '%not active%', '21: an open (unassigned) job cannot be confirmed yet');
select tests.as_owner();
select ok(not has_function_privilege('anon', 'public.confirm_job_supply(uuid,text)', 'execute'), '22: anon has no execute on confirm_job_supply');

select * from finish();
rollback;
