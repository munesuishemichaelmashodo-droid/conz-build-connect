-- 0122: admin sign-in alerts go to the OTHER owners only, once per 30 minutes, never to customers/drivers.
begin;
select plan(8);

select set_config('t.owner1', tests.create_user('al_owner_one', array['super_admin', 'admin'])::text, true);
select set_config('t.owner2', tests.create_user('al_owner_two', array['super_admin', 'admin'])::text, true);
select set_config('t.admin',  tests.create_user('al_plain_admin', array['admin'])::text, true);
select set_config('t.cust',   tests.create_user('al_customer')::text, true);
select set_config('t.drv',    tests.create_driver('al_driver', 0)::text, true);

create or replace function pg_temp.sign_in(_u text) returns void language sql as $$
  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), current_setting(_u)::uuid, now(), now())
$$;
create or replace function pg_temp.alerts_for(_u text) returns int language sql as $$
  select count(*)::int from public.notifications
   where type = 'admin_signin' and user_id = current_setting(_u)::uuid
$$;

delete from public.notifications where type = 'admin_signin';
select pg_temp.sign_in('t.owner1');
select is(pg_temp.alerts_for('t.owner1'), 0, 'an owner is not alerted about their own sign-in');
select is(pg_temp.alerts_for('t.owner2'), 1, 'the other owner is alerted');
select is(pg_temp.alerts_for('t.cust') + pg_temp.alerts_for('t.drv') + pg_temp.alerts_for('t.admin'), 0,
          'customers, drivers and non-owner admins get nothing');

select pg_temp.sign_in('t.owner1');
select is(pg_temp.alerts_for('t.owner2'), 1, 'a second sign-in within 30 minutes does not alert again');

delete from public.notifications where type = 'admin_signin';
select pg_temp.sign_in('t.admin');
select is(pg_temp.alerts_for('t.owner1') + pg_temp.alerts_for('t.owner2'), 2, 'an ordinary admin''s sign-in alerts both owners');
select is(pg_temp.alerts_for('t.cust') + pg_temp.alerts_for('t.drv'), 0, '... and still no customer or driver');

delete from public.notifications where type = 'admin_signin';
select pg_temp.sign_in('t.cust');
select pg_temp.sign_in('t.drv');
select is((select count(*)::int from public.notifications where type = 'admin_signin'), 0,
          'customer and driver sign-ins send no alert');

-- Customers can't read anyone's alerts.
select pg_temp.sign_in('t.admin');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.notifications where type = 'admin_signin'), 0,
          'a customer cannot read admin sign-in alerts');
select tests.as_owner();

select * from finish();
rollback;
