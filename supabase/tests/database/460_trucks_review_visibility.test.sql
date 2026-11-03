-- 0114 — truck changes need re-review; only approved drivers can be given a job;
-- trucks are visible only to their driver, admins, and customers they bid for.
begin;
select plan(25);
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('tr_cust')::text, true);
select set_config('t.cust2', tests.create_user('tr_cust2')::text, true);
select set_config('t.drv',   tests.create_driver('tr_drv', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('tr_drv2', 100)::text, true);
select set_config('t.drv3',  tests.create_driver('tr_drv3', 100)::text, true);
select set_config('t.admin', tests.create_user('tr_admin', array['admin'])::text, true);
select set_config('t.truck', tests.truck_of(current_setting('t.drv')::uuid)::text, true);
select set_config('t.job',   tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.job2',  tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid',   tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 380)::text, true);
select set_config('t.bid3',  tests.create_bid(current_setting('t.job2')::uuid, current_setting('t.drv3')::uuid, 380)::text, true);

create or replace function pg_temp.status_of(_uid uuid) returns text language sql as
  $$ select verification_status::text from public.driver_profiles where user_id = _uid $$;

-- ---------------------------------------------------------------------------
-- 1. Visibility
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.trucks where id = current_setting('t.truck')::uuid), 1,
  'A customer sees the truck of a driver who bid on their job');
select is((select count(*)::int from public.trucks where driver_id = current_setting('t.drv2')::uuid), 0,
  'A customer does not see trucks of drivers who did not bid for them');
select tests.login_as(current_setting('t.cust2')::uuid);
select is((select count(*)::int from public.trucks), 0, 'An unrelated customer sees no trucks');
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.trucks where driver_id <> auth.uid()), 0,
  'A driver sees no other driver''s trucks');
select is((select count(*)::int from public.trucks where driver_id = auth.uid()), 1, 'A driver sees their own truck');
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select count(*) from public.trucks) >= 3, 'An admin sees all trucks');
select tests.as_anon();
select is((select count(*)::int from public.trucks), 0, 'Anonymous visitors see no trucks');

-- ---------------------------------------------------------------------------
-- 2. Re-review after a material change
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
update public.trucks set registration = registration where id = current_setting('t.truck')::uuid;
select tests.as_owner();
select is(pg_temp.status_of(current_setting('t.drv')::uuid), 'verified', 'Saving unchanged truck details keeps approval');

select tests.login_as(current_setting('t.drv')::uuid);
update public.trucks set capacity_m3 = 30 where id = current_setting('t.truck')::uuid;
select tests.as_owner();
select is(pg_temp.status_of(current_setting('t.drv')::uuid), 'pending', 'Changing capacity sends the driver back to review');
select is((select status::text from public.bids where id = current_setting('t.bid')::uuid), 'withdrawn',
  'Their pending offers are withdrawn');
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.admin')::uuid and type = 'truck_review'),
  'Admins are told a truck needs review');
select ok(not public.is_verified_driver(current_setting('t.drv')::uuid), 'The driver is no longer a verified driver');
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.driver_available_jobs()), 0, 'Under re-review: no open jobs');

-- approve again, then a registration change and a new truck
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_set_driver_verification(%L, 'verified', 'Truck checked')$$, current_setting('t.drv')),
  'An admin re-approves through the existing workflow');
select tests.login_as(current_setting('t.drv')::uuid);
update public.trucks set registration = 'NEW-123' where id = current_setting('t.truck')::uuid;
select tests.as_owner();
select is(pg_temp.status_of(current_setting('t.drv')::uuid), 'pending', 'Changing the registration needs review');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.drv')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
update public.trucks set photo_url = 'x/new-photo.jpg' where id = current_setting('t.truck')::uuid;
select tests.as_owner();
select is(pg_temp.status_of(current_setting('t.drv')::uuid), 'pending', 'Changing the truck photo needs review');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.drv')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
insert into public.trucks (driver_id, registration, capacity_m3) values (auth.uid(), 'SECOND-1', 20);
select tests.as_owner();
select is(pg_temp.status_of(current_setting('t.drv')::uuid), 'pending', 'Adding a truck needs review');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.drv')::uuid;

-- another driver can't touch it; an admin edit doesn't reset approval
select tests.login_as(current_setting('t.drv2')::uuid);
update public.trucks set capacity_m3 = 99 where id = current_setting('t.truck')::uuid;
select tests.as_owner();
select isnt((select capacity_m3 from public.trucks where id = current_setting('t.truck')::uuid), 99::numeric,
  'A driver cannot edit another driver''s truck');
select tests.login_as(current_setting('t.drv2')::uuid);
select throws_ok(
  format($$insert into public.trucks (driver_id, registration, capacity_m3) values (%L, 'HIJACK', 10)$$,
         current_setting('t.drv')),
  '42501', null, 'A driver cannot add a truck to another driver''s account');
select tests.as_owner();
select tests.login_as(current_setting('t.admin')::uuid);
update public.trucks set capacity_m3 = 18 where id = current_setting('t.truck')::uuid;
select tests.as_owner();
select is(pg_temp.status_of(current_setting('t.drv')::uuid), 'verified', 'An admin correcting a truck does not reset approval');

-- an unverified driver keeps the job they are already doing
select set_config('t.job3', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid4', tests.create_bid(current_setting('t.job3')::uuid, current_setting('t.drv')::uuid, 380)::text, true);
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
values (current_setting('t.drv')::uuid, 'topup', 100, 100, 'opening');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid4')), 'Customer accepts an approved driver''s offer');
select tests.login_as(current_setting('t.drv')::uuid);
update public.trucks set capacity_m3 = 25 where id = current_setting('t.truck')::uuid;
select is((select count(*)::int from public.jobs where id = current_setting('t.job3')::uuid), 1,
  'A driver sent back to review still sees the job they already have');

-- ---------------------------------------------------------------------------
-- 3. Only approved drivers can be given a job
-- ---------------------------------------------------------------------------
select tests.as_owner();
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.drv3')::uuid;
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
values (current_setting('t.drv3')::uuid, 'topup', 100, 100, 'opening');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.bid3')),
  '%not approved%', 'A customer cannot accept an offer from a driver who is no longer approved');
select tests.as_owner();
select is((select driver_id from public.jobs where id = current_setting('t.job2')::uuid), null,
  'The job stays unassigned');
update public.driver_profiles set reverify_due_at = now() - interval '1 day', verification_status = 'verified'
 where user_id = current_setting('t.drv3')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.bid3')),
  '%not approved%', 'Nor from a driver whose re-verification is overdue');

select * from finish();
rollback;
