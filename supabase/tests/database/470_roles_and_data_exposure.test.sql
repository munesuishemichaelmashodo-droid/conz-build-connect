-- 0115 — no privileged role from sign-up; admins can't edit driver approval directly;
-- supplier contact details are not public; profile policies consolidated without
-- widening access; fixed search_path on two functions.
begin;
select plan(30);

select set_config('t.cust',  tests.create_user('rx_cust')::text, true);
select set_config('t.cust2', tests.create_user('rx_cust2')::text, true);
select set_config('t.drv',   tests.create_driver('rx_drv', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('rx_drv2', 100)::text, true);
select set_config('t.admin', tests.create_user('rx_admin', array['admin'])::text, true);
select set_config('t.admdrv', tests.create_driver('rx_admin_driver', 100)::text, true);
insert into public.user_roles (user_id, role) values (current_setting('t.admdrv')::uuid, 'admin');
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.admdrv')::uuid;
select set_config('t.job',   tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid',   tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 380)::text, true);
update public.profiles set phone = '+263771111111' where id = current_setting('t.cust2')::uuid;

-- ---------------------------------------------------------------------------
-- 1. Sign-up never grants a privileged role (S-3)
-- ---------------------------------------------------------------------------
-- Production fires handle_new_user from auth.users (trigger on_auth_user_created,
-- checked 25/10). The test database's baseline has no auth-schema triggers, so add
-- the same trigger here; it is rolled back with the test.
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
select set_config('t.owner_email_user', gen_random_uuid()::text, true);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (current_setting('t.owner_email_user')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'munesuishemichaelmashodo@gmail.com', '', '{"provider":"email"}', '{"role":"admin","full_name":"x"}', now(), now());
select is(
  (select array_agg(role::text order by role::text) from public.user_roles where user_id = current_setting('t.owner_email_user')::uuid),
  array['customer'],
  'Signing up with the old owner email gets only the customer role');
select set_config('t.meta_user', gen_random_uuid()::text, true);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (current_setting('t.meta_user')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'meta.' || left(current_setting('t.meta_user'), 8) || '@test.local', '', '{"provider":"email"}', '{"role":"super_admin"}', now(), now());
select is(
  (select array_agg(role::text) from public.user_roles where user_id = current_setting('t.meta_user')::uuid),
  array['customer'], 'role=super_admin in sign-up metadata gives only customer');
select set_config('t.drvmeta', gen_random_uuid()::text, true);
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (current_setting('t.drvmeta')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'drv.' || left(current_setting('t.drvmeta'), 8) || '@test.local', '', '{"provider":"email"}', '{"role":"driver"}', now(), now());
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.drvmeta')::uuid), 'pending',
  'Driver sign-up still creates a pending driver profile');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')$$, '42501', null,
  'A user cannot insert an admin role for themselves');
select throws_ok($$update public.user_roles set role = 'super_admin' where user_id = auth.uid()$$, '42501', null,
  'A user cannot update their own role (0125: no direct writes)');
select tests.as_owner();
select ok(not public.has_role(current_setting('t.cust')::uuid, 'super_admin'),
  'A user cannot turn their own role into super admin');

-- ---------------------------------------------------------------------------
-- 2. Admins must use the verification workflow (S-7)
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$update public.driver_profiles set verification_status = 'rejected' where user_id = %L$$, current_setting('t.drv')),
  '42501', null, 'An admin cannot change a driver''s status with a direct update');
select throws_ok(format($$update public.driver_profiles set first_job_free_used = false where user_id = %L$$, current_setting('t.drv')),
  '42501', null, 'An admin cannot reset the free first job directly');
select throws_ok(format($$update public.driver_profiles set reverify_due_at = now() + interval '5 years' where user_id = %L$$, current_setting('t.drv')),
  '42501', null, 'An admin cannot push re-verification out directly');
select lives_ok(format($$select public.admin_set_driver_verification(%L, 'rejected', 'Blurry ID')$$, current_setting('t.drv2')),
  'The verification function still works for admins');
select tests.as_owner();
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.drv2')::uuid), 'rejected',
  'and records the decision');
select ok(exists (select 1 from public.admin_audit_log where target_user_id = current_setting('t.drv2')::uuid), 'with an audit row');
select tests.login_as(current_setting('t.admdrv')::uuid);
select throws_ok($$update public.driver_profiles set verification_status = 'verified' where user_id = auth.uid()$$,
  '42501', null, 'An admin who is also a driver cannot approve themselves directly');
select throws_ok(format($$select public.admin_set_driver_verification(%L, 'verified', null)$$, current_setting('t.admdrv')),
  null, null, 'nor through the verification function');
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok($$update public.driver_profiles set nationality = 'Zimbabwe' where user_id = auth.uid()$$,
  'Drivers can still edit their own allowed fields');

-- ---------------------------------------------------------------------------
-- 3. Supplier contact details (S-6)
-- ---------------------------------------------------------------------------
select tests.as_owner();
insert into public.suppliers (name, contact_phone, contact_email, notes)
values ('Test Quarry', '+263770000001', 'quarry@test.local', 'internal note');
select tests.as_anon();
select is((select count(*)::int from public.suppliers where name = 'Test Quarry'), 1, 'Anyone can still see supplier names');
select throws_ok($$select contact_phone from public.suppliers$$, '42501', null, 'Anonymous visitors cannot read supplier phone numbers');
select throws_ok($$select contact_email from public.suppliers$$, '42501', null, 'or email addresses');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select notes, contact_phone from public.suppliers$$, '42501', null, 'Signed-in users cannot read them either');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select contact_phone from public.admin_list_supplier_contacts() where name = 'Test Quarry'), '+263770000001',
  'Admins read contacts through admin_list_supplier_contacts');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select * from public.admin_list_supplier_contacts()$$, '42501', null, 'Non-admins cannot call it');

-- ---------------------------------------------------------------------------
-- 4. Profiles: consolidated policies, same access (S-4)
-- ---------------------------------------------------------------------------
select tests.as_owner();
select is((select count(*)::int from pg_policy where polrelid = 'public.profiles'::regclass), 6,
  'Six profile policies instead of nine');
select tests.login_as(current_setting('t.cust2')::uuid);
select is((select count(*)::int from public.profiles where id = auth.uid()), 1, 'A user reads their own profile');
select is((select count(*)::int from public.profiles where id <> auth.uid()), 0, 'and no one else''s');
update public.profiles set phone = '+263779999999' where id = current_setting('t.cust')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.profiles where id = current_setting('t.drv')::uuid), 1,
  'A customer reads the profile of a driver who bid on their job');
select is((select count(*)::int from public.profiles where id = current_setting('t.drv2')::uuid), 0,
  'but not of a driver who did not');
select is((select phone from public.profiles where id = auth.uid()), null::text, 'Another user could not change this customer''s phone');
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select count(*) from public.profiles) >= 6, 'Admins read all profiles');
select tests.as_anon();
select is((select count(*)::int from public.profiles), 0, 'Anonymous visitors read no profiles');

-- ---------------------------------------------------------------------------
-- 5. Fixed search_path
-- ---------------------------------------------------------------------------
select tests.as_owner();
select is((select count(*)::int from pg_proc where proname in ('tg_sourcing_history_immutable', 'sourcing_transition_allowed')
            and pronamespace = 'public'::regnamespace and proconfig is null), 0,
  'Both sourcing functions have a fixed search_path');

select * from finish();
rollback;
