-- 0132: driver verification timeline and 24 business hours (Africa/Harare) service level.
begin;
select plan(22);

select set_config('t.cust',  tests.create_user('vs_cust')::text, true);
select set_config('t.admin', tests.create_user('vs_admin', array['admin'])::text, true);
select set_config('t.sup',   tests.create_user('vs_sup', array['super_admin'])::text, true);
select set_config('t.d1',    tests.create_user('vs_d1')::text, true);

-- Holidays start empty (nothing hard-coded)
select is((select count(*)::int from public.business_holidays), 0, 'no holiday list is hard-coded');

-- 24 business hours arithmetic (2026-11-06 is a Friday, 2026-11-09 a Monday; Harare is UTC+2)
select is(public.business_hours_elapsed('2026-11-03 09:00+02', '2026-11-04 09:00+02'), 24::numeric, 'Tuesday 09:00 to Wednesday 09:00 is 24 hours');
select is(public.business_hours_elapsed('2026-11-06 15:00+02', '2026-11-09 15:00+02'), 24::numeric,
  'Friday 15:00 to Monday 15:00 is 24 business hours (the weekend does not count)');
select is(public.business_hours_elapsed('2026-11-07 10:00+02', '2026-11-08 20:00+02'), 0::numeric, 'a weekend counts as nothing');
select cmp_ok(public.business_hours_elapsed('2026-11-06 15:00+02', '2026-11-09 14:59+02'), '<', 24::numeric, 'one minute short of 24 hours is not yet due');

-- A configured holiday is skipped
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select lives_ok($$select public.admin_set_business_holiday('2026-11-09', 'Test holiday', false, 'testing the boundary')$$,
  'a super admin with a step-up can add a holiday');
select is(public.business_hours_elapsed('2026-11-06 15:00+02', '2026-11-10 15:00+02'), 24::numeric,
  'Friday 15:00 to Tuesday 15:00 is 24 business hours when Monday is a holiday');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok($$select public.admin_set_business_holiday('2026-11-10', 'x holiday', false, 'ordinary admin attempt')$$, '42501', null,
  'an ordinary admin cannot change holidays');

-- Timeline and queue
select tests.as_owner();
insert into public.driver_profiles (user_id, verification_status) values (current_setting('t.d1')::uuid, 'pending');
select is((select count(*)::int from public.verification_events where driver_id = current_setting('t.d1')::uuid and event = 'submitted'), 1,
  'a new pending driver records a submission');
select ok(exists (select 1 from public.notifications where type = 'verification_submitted' and user_id = current_setting('t.admin')::uuid),
  'admins are told a driver is waiting');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select * from public.admin_verification_queue()$$, '42501', null, 'customers cannot read the queue');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select overdue from public.admin_verification_queue() where driver_id = current_setting('t.d1')::uuid), false, 'not overdue straight away');

-- Overdue: alert only
select tests.as_owner();
update public.system_settings set value = '0'::jsonb where key = 'verification_sla_hours';
select tests.login_as(current_setting('t.admin')::uuid);
select is((select overdue from public.admin_verification_queue() where driver_id = current_setting('t.d1')::uuid), true, 'overdue once the target is passed');
select tests.as_owner();
select is(public.flag_overdue_verifications(), 1, 'one overdue alert is raised');
select is(public.flag_overdue_verifications(), 0, 'running it again raises no second alert');
select ok(exists (select 1 from public.notifications where type = 'verification_overdue' and user_id = current_setting('t.admin')::uuid), 'admins get the alert');
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.d1')::uuid), 'pending',
  'overdue never approves, rejects or suspends');

-- Correction pauses the clock; resubmission restarts it
update public.driver_profiles set verification_status = 'rejected' where user_id = current_setting('t.d1')::uuid;
select is((select count(*)::int from public.verification_events where driver_id = current_setting('t.d1')::uuid and event = 'rejected'), 1, 'a rejection is recorded');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*)::int from public.admin_verification_queue() where driver_id = current_setting('t.d1')::uuid), 0, 'a returned submission is out of the queue (clock paused)');
select tests.as_owner();
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.d1')::uuid;
select is((select count(*)::int from public.verification_events where driver_id = current_setting('t.d1')::uuid and event = 'resubmitted'), 1, 'a resubmission is recorded as such');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.d1')::uuid;
select is((select count(*)::int from public.verification_events where driver_id = current_setting('t.d1')::uuid and event = 'approved'), 1, 'approval is recorded');

-- History is append-only
select throws_ok($$update public.verification_events set at = now() - interval '9 days'$$, '42501', null, 'the timeline cannot be edited');

select * from finish();
rollback;
