-- Driver sign-up without SMS (25/10/2026). The phone step now saves the number to
-- the applicant's own profile and sends no SMS. This proves the server-side gates
-- don't depend on phone verification and still hold: saving a phone or details
-- grants nothing; only admin approval grants the driver role; pending applicants
-- can't see or bid on jobs; verified drivers keep access. No schema change.

begin;
select plan(23);

select set_config('t.cust',   tests.create_user('cust')::text, true);
select set_config('t.drv',    tests.create_driver('verified', 100)::text, true);
select set_config('t.appl',   tests.create_user('applicant', array['customer'])::text, true);
select set_config('t.appl2',  tests.create_user('driver_signup', array['driver'])::text, true);
select set_config('t.admin',  tests.create_user('admin', array['admin'])::text, true);
select set_config('t.job',    tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);

-- ---------------------------------------------------------------------------
-- Applicant (customer account) walks the new steps
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.appl')::uuid);
select lives_ok(
  $$insert into public.driver_profiles (user_id) values (auth.uid()) on conflict (user_id) do nothing$$,
  'Applicant creates their own driver profile');
update public.profiles set phone = '+263771234567' where id = auth.uid();
select is((select phone from public.profiles where id = auth.uid()), '+263771234567',
  'Phone step: the applicant saves a number on their own profile');
update public.profiles set phone = '+263770000000' where id = current_setting('t.cust')::uuid;
update public.driver_profiles set nationality = 'Zimbabwe' where user_id = auth.uid();
select is((select nationality from public.driver_profiles where user_id = auth.uid()), 'Zimbabwe',
  'Details step: nationality saved on their own driver profile');
-- Documents step: the applicant registers a truck (so the bid test below hits
-- the approval gate, not the "no truck" check).
insert into public.trucks (driver_id, registration, capacity_m3) values (auth.uid(), 'APPL-001', 10);
select lives_ok(
  $$update public.driver_profiles set verification_status = 'pending' where user_id = auth.uid()$$,
  'Submit: the applicant can set their status to pending');
select throws_ok(
  $$update public.driver_profiles set verification_status = 'verified' where user_id = auth.uid()$$,
  null, null, 'An applicant cannot approve themselves');

select tests.as_owner();
select isnt((select phone from public.profiles where id = current_setting('t.cust')::uuid), '+263770000000',
  'Phone step cannot write another user''s profile');
select is(
  (select phone_confirmed_at from auth.users where id = current_setting('t.appl')::uuid), null,
  'Saving a phone leaves the Auth phone unconfirmed');
select is(
  (select verification_status::text from public.driver_profiles where user_id = current_setting('t.appl')::uuid),
  'pending', 'Application is pending');
select ok(not public.has_role(current_setting('t.appl')::uuid, 'driver'),
  'Saving a phone and details grants no driver role');
select ok(not public.is_verified_driver(current_setting('t.appl')::uuid),
  'A pending applicant is not a verified driver');

select tests.login_as(current_setting('t.appl')::uuid);
select is((select count(*)::int from public.jobs where status = 'open'), 0,
  'A pending applicant cannot read open jobs');
select is((select count(*)::int from public.driver_available_jobs()), 0,
  'driver_available_jobs is empty for a pending applicant');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, auth.uid(), 380, %L)$$,
         current_setting('t.job'), tests.truck_of(auth.uid())),
  null, null, 'A pending applicant cannot bid (the job is hidden from them)');

-- ---------------------------------------------------------------------------
-- Signed up as a driver (has the driver role) but still pending
-- ---------------------------------------------------------------------------
select tests.as_owner();
insert into public.driver_profiles (user_id) values (current_setting('t.appl2')::uuid) on conflict do nothing;
update public.profiles set phone = '+263772222222' where id = current_setting('t.appl2')::uuid;
insert into public.trucks (driver_id, registration, capacity_m3) values (current_setting('t.appl2')::uuid, 'APPL-002', 10);
select tests.login_as(current_setting('t.appl2')::uuid);
select is((select count(*)::int from public.jobs where status = 'open'), 0,
  'Driver role + pending: still no open jobs');
select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, auth.uid(), 380, %L)$$,
         current_setting('t.job'), tests.truck_of(auth.uid())),
  null, null, 'Driver role + pending: still cannot bid');
select tests.as_owner();
select is((select count(*)::int from public.bids where driver_id in
            (current_setting('t.appl')::uuid, current_setting('t.appl2')::uuid)), 0,
  'No bid row exists for either pending applicant');

-- ---------------------------------------------------------------------------
-- Only admin approval grants access; admins can't approve themselves
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(
  format($$select public.admin_set_driver_verification(%L, 'verified', null)$$, current_setting('t.admin')),
  null, null, 'An admin cannot approve their own driver application');
select lives_ok(
  format($$select public.admin_set_driver_verification(%L, 'verified', 'Documents checked')$$,
         current_setting('t.appl')),
  'An admin approves the applicant through the existing workflow');

select tests.as_owner();
select ok(public.has_role(current_setting('t.appl')::uuid, 'driver'),
  'Approval grants the driver role');
select is(
  (select phone_confirmed_at from auth.users where id = current_setting('t.appl')::uuid), null,
  'Approval does not mark the phone as SMS-verified');
select tests.login_as(current_setting('t.appl')::uuid);
select ok((select count(*) from public.jobs where id = current_setting('t.job')::uuid) = 1,
  'Once approved, the driver can see the open job');

-- ---------------------------------------------------------------------------
-- Existing verified drivers keep access
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
select ok((select count(*) from public.driver_available_jobs() where id = current_setting('t.job')::uuid) = 1,
  'An existing verified driver still sees the job');
select lives_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, auth.uid(), 380, %L)$$,
         current_setting('t.job'), tests.truck_of(current_setting('t.drv')::uuid)),
  'An existing verified driver can still bid');

select * from finish();
rollback;
