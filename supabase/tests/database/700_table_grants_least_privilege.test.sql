-- 0138: signed-out visitors cannot write or truncate; nobody client-side can truncate; the app's own writes still work.
begin;
select plan(7);

select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'anon'
              and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')), 0,
  'anon holds no write, truncate, trigger or reference privilege on any public table');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated'
              and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')), 0,
  'signed-in users cannot truncate, add triggers or reference public tables');
select ok((select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'INSERT') > 0,
  'signed-in users keep INSERT where row security allows it');

select set_config('t.u', tests.create_user('gr_user')::text, true);
select tests.login_as(current_setting('t.u')::uuid);
select lives_ok($$update public.profiles set full_name = 'Grants Test' where id = auth.uid()$$, 'a user can still edit their own profile');
select throws_ok('truncate public.notifications', '42501', null, 'a signed-in user cannot truncate a table');
select tests.as_anon();
select throws_ok($$insert into public.notifications (user_id, title, body, type) values (gen_random_uuid(), 'x', 'y', 'info')$$, '42501', null, 'a visitor cannot insert');
select throws_ok('truncate public.jobs', '42501', null, 'a visitor cannot truncate');

select * from finish();
rollback;
