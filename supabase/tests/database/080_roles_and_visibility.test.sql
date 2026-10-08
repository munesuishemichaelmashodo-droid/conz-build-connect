-- Phases 9-10 / audit F8 — role escalation, open-job visibility, tracking
-- token exposure.

begin;
select plan(26);

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.drv',   tests.create_driver('verified', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('verified2', 100)::text, true);
select set_config('t.appl',  tests.create_user('applicant', array['customer'])::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('super', array['super_admin','admin'])::text, true);
select set_config('t.job',   tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set notes = 'Gate code 4471' where id = current_setting('t.job')::uuid;

-- ---------------------------------------------------------------------------
-- Role escalation
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.appl')::uuid);
select throws_ok($$select public.self_add_base_role('admin')$$, null, null, 'F8: cannot self-grant admin');
select throws_ok($$select public.self_add_base_role('super_admin')$$, null, null, 'F8: cannot self-grant super_admin');
select throws_ok($$insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')$$, '42501', null,
  'F8: cannot insert an admin role row directly');
select throws_ok($$select public.admin_grant_role(auth.uid(), 'super_admin')$$, null, null, 'F8: cannot call admin_grant_role');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_grant_role(%L, 'super_admin')$$, current_setting('t.appl')), null, null,
  'F8: an ordinary admin cannot grant roles');
select tests.login_as(current_setting('t.super')::uuid);
select throws_like(format($$select public.admin_grant_role(%L, 'admin')$$, current_setting('t.appl')), 'MFA_REQUIRED%',
  'F8: granting admin requires an MFA session');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$select public.admin_grant_role(%L, 'driver', 'manual onboarding')$$, current_setting('t.cust')),
  'A super admin can still grant ordinary roles');
select tests.as_owner();
select is((select count(*)::int from public.user_roles where user_id = current_setting('t.appl')::uuid and role in ('admin','super_admin')), 0,
  'Applicant gained no privileged role');
delete from public.user_roles where user_id = current_setting('t.cust')::uuid and role = 'driver';

-- ---------------------------------------------------------------------------
-- Open-job visibility: self-declared (unverified) drivers see nothing
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.appl')::uuid);
select lives_ok($$select public.self_add_base_role('driver')$$, 'Anyone can still become a driver APPLICANT');
select lives_ok($$insert into public.driver_profiles (user_id) values (auth.uid())$$, 'Applicant creates a (pending) profile');
select is((select count(*)::int from public.jobs where status = 'open'), 0,
  'F8: an unverified driver cannot read open jobs (addresses, notes, tokens)');
select is((select count(*)::int from public.driver_available_jobs()), 0,
  'F8: driver_available_jobs returns nothing to an unverified driver');
select is((select count(*)::int from public.find_next_loads_for_driver(auth.uid(), current_setting('t.job')::uuid)), 0,
  'F8: next-load suggestions return nothing to an unverified driver');

select tests.login_as(current_setting('t.drv')::uuid);
select ok((select count(*) from public.jobs where id = current_setting('t.job')::uuid) = 1,
  'A verified driver can see the open job to quote on it');
select ok((select count(*) from public.driver_available_jobs() where id = current_setting('t.job')::uuid) = 1,
  'A verified driver sees it in driver_available_jobs');
select set_config('t.token_open', (select tracking_token::text from public.jobs where id = current_setting('t.job')::uuid), true);

-- Re-verification overdue = not verified any more
select tests.as_owner();
update public.driver_profiles set reverify_due_at = now() - interval '1 day' where user_id = current_setting('t.drv2')::uuid;
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.jobs where status = 'open'), 0, 'A driver past re-verification loses open-job access');

-- ---------------------------------------------------------------------------
-- Tracking token rotation on acceptance
-- ---------------------------------------------------------------------------
select tests.as_owner();
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 380)::text, true);
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
values (current_setting('t.drv')::uuid, 'topup', 100, 100, 'opening');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid')), 'Customer accepts the bid');
select set_config('t.token_live', (select tracking_token::text from public.jobs where id = current_setting('t.job')::uuid), true);
select isnt(current_setting('t.token_live'), current_setting('t.token_open'), 'F8: tracking token rotated on acceptance');

select tests.as_anon();
select ok(public.get_public_tracking(current_setting('t.token_open')::uuid) is null,
  'F8: a token seen while the job was open no longer works');
select ok(public.get_public_tracking(current_setting('t.token_live')::uuid) is not null,
  'The customer''s current tracking link works');
select ok(public.get_public_tracking(gen_random_uuid()) is null, 'A guessed token returns nothing');

select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid), 0,
  'Other drivers cannot read the job once it is taken');
select tests.login_as(current_setting('t.drv')::uuid);
select is((select delivery_pin from public.jobs where id = current_setting('t.job')::uuid), null,
  'The assigned driver never sees a delivery PIN on the job row');

-- Cancelled and old completed jobs stop resolving
select tests.as_owner();
update public.jobs set status = 'cancelled' where id = current_setting('t.job')::uuid;
select tests.as_anon();
select ok(public.get_public_tracking(current_setting('t.token_live')::uuid) is null, 'F8: tracking links stop for cancelled jobs');
select tests.as_owner();
update public.jobs set status = 'completed', completed_at = now() - interval '91 days' where id = current_setting('t.job')::uuid;
select tests.as_anon();
select ok(public.get_public_tracking(current_setting('t.token_live')::uuid) is null, 'F8: tracking links expire 90 days after completion');
select tests.as_owner();
update public.jobs set completed_at = now() - interval '5 days' where id = current_setting('t.job')::uuid;
select tests.as_anon();
select ok(public.get_public_tracking(current_setting('t.token_live')::uuid) is not null, 'Recent receipts still work');

select * from finish();
rollback;
