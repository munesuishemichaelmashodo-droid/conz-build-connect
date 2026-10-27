-- 0124: material and bucket price setters need a super admin with a fresh step-up.
begin;
select plan(7);
select set_config('t.admin', tests.create_user('ps_admin', array['admin'])::text, true);
select set_config('t.sup',   tests.create_user('ps_sup', array['super_admin'])::text, true);
select set_config('t.cust',  tests.create_user('ps_cust')::text, true);
select set_config('t.min', (select min_price::text from public.material_prices where material = 'gravel'), true);
select set_config('t.max', (select max_price::text from public.material_prices where material = 'gravel'), true);

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.admin_set_material_price('gravel', 1, 2, null, null, null, 'test reason')$$,
  '42501', null, 'customers cannot change material prices');

select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_ok($$select public.admin_set_material_price('gravel', 1, 2, 3.0, false, null, 'test reason')$$,
  '42501', null, 'an ordinary admin cannot change material prices (or the multiplier) even after a step-up');
select throws_ok($$select public.admin_set_material_bucket_price('gravel', 10, 1, 2, 'test reason')$$,
  '42501', null, 'an ordinary admin cannot change bucket prices');

select tests.login_as(current_setting('t.sup')::uuid);
select throws_like(format($$select public.admin_set_material_price('gravel', %s, %s, null, null, null, 'test reason')$$,
  current_setting('t.min'), current_setting('t.max')), '%', 'a super admin without a fresh step-up is refused');
select throws_like($$select public.admin_set_material_bucket_price('gravel', 10, 100, 120, 'test reason')$$, '%',
  'bucket prices too');

select tests.login_as_mfa(current_setting('t.sup')::uuid);
select is((public.admin_set_material_price('gravel', current_setting('t.min')::numeric, current_setting('t.max')::numeric,
           null, null, null, 'test reason')).material::text, 'gravel', 'a super admin with a fresh step-up can');
select is((public.admin_set_material_bucket_price('gravel', 10, 100, 120, 'test reason')).max_price, 120::numeric,
  '... and bucket prices too');

select * from finish();
rollback;
