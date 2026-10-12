-- 0100 — regression: admin_set_diesel_price used to fail for everyone (bad log_admin_action call).
begin;
select plan(8);

select set_config('t.cust', tests.create_user('dz_cust')::text, true);
select set_config('t.adm',  tests.create_user('dz_adm', array['admin'])::text, true);
select set_config('t.sup',  tests.create_user('dz_sup', array['admin','super_admin'])::text, true);

select tests.login_as_mfa(current_setting('t.sup')::uuid);
select lives_ok($$select public.admin_set_diesel_price(1.95)$$, 'A super admin can set the diesel price');
select tests.as_owner();
select is((select (value::text)::numeric from public.system_settings where key = 'diesel_price_per_liter'), 1.95::numeric, 'The new price is stored');
select is((select count(*)::int from public.admin_audit_log
            where action = 'diesel_price_changed' and (meta->>'price')::numeric = 1.95
              and actor_id = current_setting('t.sup')::uuid), 1, 'The change is written to the admin audit log with the actor and price');

select tests.login_as_mfa(current_setting('t.sup')::uuid);
select throws_like($$select public.admin_set_diesel_price(0)$$, '%between 0 and 100%', 'Zero is rejected');
select throws_like($$select public.admin_set_diesel_price(101)$$, '%between 0 and 100%', 'Over 100 is rejected');
select throws_like($$select public.admin_set_diesel_price(null)$$, '%between 0 and 100%', 'NULL is rejected');
select tests.login_as(current_setting('t.adm')::uuid);
select throws_like($$select public.admin_set_diesel_price(2.5)$$, '%Only super admins%', 'A plain admin cannot change it');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like($$select public.admin_set_diesel_price(2.5)$$, '%Only super admins%', 'A customer cannot change it');

select * from finish();
rollback;
