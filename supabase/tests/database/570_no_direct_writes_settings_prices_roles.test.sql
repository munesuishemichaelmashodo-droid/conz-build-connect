-- 0125: a super admin session cannot write settings, prices or roles directly; the audited functions still work.
begin;
select plan(8);
select set_config('t.sup',  tests.create_user('dw_sup', array['super_admin'])::text, true);
select set_config('t.cust', tests.create_user('dw_cust')::text, true);

select tests.login_as_mfa(current_setting('t.sup')::uuid);
select throws_ok($$update public.system_settings set value = '0'::jsonb where key = 'commission_rate'$$,
  '42501', null, 'super admin cannot set the commission rate by writing the table');
select throws_ok($$insert into public.system_settings (key, value) values ('payment_provider', '"payonify"'::jsonb)
                   on conflict (key) do update set value = excluded.value$$,
  '42501', null, '... or flip a switch');
select throws_ok($$update public.material_prices set demand_multiplier = 3 where material = 'gravel'$$,
  '42501', null, '... or change a material price directly');
select throws_ok($$delete from public.material_price_buckets$$, '42501', null, '... or delete bucket prices');
select throws_ok($$update public.small_load_settings set minimum_trip_charge = 0$$, '42501', null, '... or the minimum trip charge');
select throws_ok(format($$insert into public.user_roles (user_id, role) values (%L, 'admin')$$, current_setting('t.cust')),
  '42501', null, '... or make someone an admin directly');

-- The audited path still works.
select lives_ok($$select public.admin_set_material_bucket_price('gravel', 10, 100, 120, 'test reason')$$,
  'the audited price function still works');
select tests.as_owner();
select ok(exists (select 1 from public.admin_audit_log where action = 'material_bucket_price_updated'),
  '... and leaves an audit row');

select * from finish();
rollback;
