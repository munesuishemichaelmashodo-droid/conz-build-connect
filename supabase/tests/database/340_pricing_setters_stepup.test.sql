-- 0103 — owner decision 2026-10-12: diesel price and demand multiplier changes need
-- super_admin AND a fresh step-up (aal2 + recent TOTP). Plain admins can no longer set the multiplier.
begin;
select plan(23);

select set_config('t.cust', tests.create_user('ps_cust')::text, true);
select set_config('t.adm',  tests.create_user('ps_adm', array['admin'])::text, true);
select set_config('t.sup',  tests.create_user('ps_sup', array['admin','super_admin'])::text, true);

select tests.as_owner();
select set_config('t.mult0', (select demand_multiplier::text from public.material_prices where enforced = true limit 1), true);

-- ---------------- demand multiplier ----------------
-- 1-3: not allowed without the role
select tests.login_as_mfa(current_setting('t.adm')::uuid);
select throws_like($$select public.admin_set_demand_multiplier(1.2, 'diesel went up')$$, '%Only super admins%', '1: a plain admin with a FRESH step-up still cannot set the multiplier');
select tests.login_as_mfa(current_setting('t.cust')::uuid);
select throws_like($$select public.admin_set_demand_multiplier(1.2, 'diesel went up')$$, '%Only super admins%', '2: a customer cannot');
select tests.as_anon();
select throws_ok($$select public.admin_set_demand_multiplier(1.2, 'diesel went up')$$, null, null, '3: anonymous cannot');

-- 4-6: super admin without / with stale step-up
select tests.login_as(current_setting('t.sup')::uuid);
select throws_like($$select public.admin_set_demand_multiplier(1.2, 'diesel went up')$$, '%MFA_REQUIRED%', '4: a super admin WITHOUT a second-factor session is refused');
select tests.login_as_mfa_aged(current_setting('t.sup')::uuid, 30);
select throws_like($$select public.admin_set_demand_multiplier(1.2, 'diesel went up')$$, '%expired%', '5: a super admin with an EXPIRED step-up (30 min) is refused');
select tests.as_owner();
select is((select demand_multiplier::text from public.material_prices where enforced = true limit 1), current_setting('t.mult0'), '6: nothing changed after the refusals');

-- 7-11: allowed with fresh step-up; bounds and reason still enforced
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select lives_ok($$select public.admin_set_demand_multiplier(1.15, 'diesel up 8 percent')$$, '7: a super admin with a fresh step-up can set the multiplier');
select throws_like($$select public.admin_set_demand_multiplier(0, 'diesel up 8 percent')$$, '%between 0 and 3%', '8: zero is still rejected');
select throws_like($$select public.admin_set_demand_multiplier(3.5, 'diesel up 8 percent')$$, '%between 0 and 3%', '9: above 3.0 is still rejected');
select throws_like($$select public.admin_set_demand_multiplier(1.1, 'x')$$, '%reason%', '10: a reason is still required');
select tests.as_owner();
select is((select count(*)::int from public.material_prices where enforced = true and demand_multiplier = 1.15), (select count(*)::int from public.material_prices where enforced = true), '11: the new multiplier applies to every enforced material');
select is((select count(*)::int from public.admin_audit_log where action = 'demand_multiplier_updated' and actor_id = current_setting('t.sup')::uuid), 1, '12: the change is in the admin audit log with the actor');

-- ---------------- diesel price ----------------
select tests.login_as_mfa(current_setting('t.adm')::uuid);
select throws_like($$select public.admin_set_diesel_price(2.1)$$, '%Only super admins%', '13: a plain admin with a fresh step-up cannot set the diesel price');
select tests.login_as(current_setting('t.sup')::uuid);
select throws_like($$select public.admin_set_diesel_price(2.1)$$, '%MFA_REQUIRED%', '14: a super admin without a second-factor session is refused');
select tests.login_as_mfa_aged(current_setting('t.sup')::uuid, 30);
select throws_like($$select public.admin_set_diesel_price(2.1)$$, '%expired%', '15: an expired step-up is refused');
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select lives_ok($$select public.admin_set_diesel_price(2.10)$$, '16: a super admin with a fresh step-up can set the diesel price');
select throws_like($$select public.admin_set_diesel_price(0)$$, '%between 0 and 100%', '17: zero rejected');
select throws_like($$select public.admin_set_diesel_price(101)$$, '%between 0 and 100%', '18: over 100 rejected');
select throws_like($$select public.admin_set_diesel_price(null)$$, '%between 0 and 100%', '19: NULL rejected');
select tests.as_owner();
select is((select (value::text)::numeric from public.system_settings where key = 'diesel_price_per_liter'), 2.10::numeric, '20: the price is stored');
select is((select count(*)::int from public.admin_audit_log where action = 'diesel_price_changed' and actor_id = current_setting('t.sup')::uuid and (meta->>'price')::numeric = 2.10), 1, '21: the change is audited with the actor');

-- no client can reach the setters anonymously
select ok(not has_function_privilege('anon', 'public.admin_set_demand_multiplier(numeric,text)', 'execute'), '22: anon has no execute on the multiplier setter');
select ok(not has_function_privilege('anon', 'public.admin_set_diesel_price(numeric)', 'execute'), '23: anon has no execute on the diesel setter');

select * from finish();
rollback;
