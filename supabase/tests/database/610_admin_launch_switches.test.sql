-- 0129: launch switches are changed only by a super admin with a fresh step-up, a reason and an audit row.
begin;
select plan(14);
select set_config('t.admin', tests.create_user('ls_admin', array['admin'])::text, true);
select set_config('t.sup',   tests.create_user('ls_sup', array['super_admin'])::text, true);
select set_config('t.cust',  tests.create_user('ls_cust')::text, true);

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.admin_set_launch_switch('escrow_enabled', 'true'::jsonb, 'launch test')$$,
  '42501', null, 'customers cannot change launch switches');

select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_ok($$select public.admin_set_launch_switch('escrow_enabled', 'true'::jsonb, 'launch test')$$,
  '42501', null, 'an ordinary admin cannot, even after a step-up');

select tests.login_as(current_setting('t.sup')::uuid);
select throws_like($$select public.admin_set_launch_switch('escrow_enabled', 'true'::jsonb, 'launch test')$$, '%',
  'a super admin without a fresh step-up is refused');

select tests.login_as_mfa(current_setting('t.sup')::uuid);
select throws_ok($$select public.admin_set_launch_switch('escrow_enabled', 'true'::jsonb, 'x')$$,
  '22023', null, 'a reason of at least 5 characters is required');
select throws_ok($$select public.admin_set_launch_switch('max_job_budget', '"lots"'::jsonb, 'launch test')$$,
  '22023', null, 'numbers must be numbers');
select throws_ok($$select public.admin_set_launch_switch('escrow_enabled', '1'::jsonb, 'launch test')$$,
  '22023', null, 'switches must be true or false');
select throws_ok($$select public.admin_set_launch_switch('max_job_budget', '999999'::jsonb, 'launch test')$$,
  '22023', null, 'limits are bounded');
select throws_ok($$select public.admin_set_launch_switch('commission_rate', '0'::jsonb, 'launch test')$$,
  '22023', null, 'only the five launch keys can be changed (not the commission)');

select is((public.admin_set_launch_switch('withdrawals_enabled', 'true'::jsonb, 'launch test')) ->> 'withdrawalsEnabled', 'true',
  'a super admin with a step-up can switch withdrawals on');
select is(((public.admin_set_launch_switch('max_job_budget', '750'::jsonb, 'launch test')) ->> 'maxJobBudget')::numeric, 750::numeric,
  '... and raise the job limit');
select tests.as_owner();
select ok(exists (select 1 from public.admin_audit_log where action = 'launch_switch_changed' and reason = 'launch test'),
  'each change leaves an audit row');
select is((select value #>> '{}' from public.system_settings where key = 'commission_rate'), '7', 'the commission is untouched');
select is((select (public.launch_switches() ->> 'escrowEnabled')), 'false', 'escrow stays off unless it is switched on');
select is((select count(*)::int from public.admin_audit_log where action = 'launch_switch_changed'), 2, 'two changes, two audit rows');

select * from finish();
rollback;
