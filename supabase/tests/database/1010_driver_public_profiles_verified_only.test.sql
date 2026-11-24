-- 0170: driver_public_profiles lists verified drivers only (plus the viewer's own row, and admins).
begin;
select plan(8);

select tests.as_owner();
select set_config('t.ok',   tests.create_driver('dpp_verified')::text, true);
select set_config('t.pend', tests.create_user('dpp_pending', array['driver'])::text, true);
insert into public.driver_profiles (user_id, verification_status) values (current_setting('t.pend')::uuid, 'pending')
  on conflict (user_id) do update set verification_status = 'pending';
select set_config('t.rej',  tests.create_user('dpp_rejected', array['driver'])::text, true);
insert into public.driver_profiles (user_id, verification_status) values (current_setting('t.rej')::uuid, 'rejected')
  on conflict (user_id) do update set verification_status = 'rejected';
select set_config('t.cust',  tests.create_user('dpp_customer')::text, true);
select set_config('t.admin', tests.create_user('dpp_admin', array['admin'])::text, true);

-- A customer sees the verified driver and nobody else.
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.driver_public_profiles where user_id = current_setting('t.ok')::uuid), 1,
          'a customer still sees a verified driver');
select is((select count(*)::int from public.driver_public_profiles where user_id = current_setting('t.pend')::uuid), 0,
          'a customer no longer sees a pending driver');
select is((select count(*)::int from public.driver_public_profiles where user_id = current_setting('t.rej')::uuid), 0,
          'a customer no longer sees a rejected driver');
select is((select count(*)::int from public.driver_public_profiles where verification_status <> 'verified'), 0,
          'no unverified row is visible to a customer');

-- A pending driver still sees their own row.
select tests.login_as(current_setting('t.pend')::uuid);
select is((select verification_status::text from public.driver_public_profiles where user_id = current_setting('t.pend')::uuid), 'pending',
          'a pending driver still reads their own row');

-- Admins see everyone.
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*)::int from public.driver_public_profiles
            where user_id in (current_setting('t.ok')::uuid, current_setting('t.pend')::uuid, current_setting('t.rej')::uuid)), 3,
          'an admin sees all three drivers');

-- Visitors still get nothing; columns are unchanged.
select tests.as_anon();
select throws_ok($$select count(*) from public.driver_public_profiles$$, '42501', null, 'anon still cannot read the view');
select tests.as_owner();
select is((select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'driver_public_profiles'),
          'user_id,rating_avg,rating_count,level,jobs_completed,verification_status',
          'the view keeps the same columns in the same order');

select * from finish();
rollback;
