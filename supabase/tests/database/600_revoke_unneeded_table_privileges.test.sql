-- 0128: anon and authenticated no longer hold privileges nothing needs; every normal operation still works.
begin;
select plan(19);

-- State -------------------------------------------------------------------------------
select is((select count(*)::int from information_schema.role_table_grants g
             join pg_class c on c.relname = g.table_name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
            where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
              and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')), 0,
  'no TRUNCATE / REFERENCES / TRIGGER for anon or authenticated on public tables');
select is((select count(*)::int from information_schema.role_table_grants g
             join pg_class c on c.relname = g.table_name and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
            where g.table_schema = 'public' and g.grantee = 'anon'
              and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 0,
  'anon cannot write any public table');
select is((select count(*)::int
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' and c.relkind in ('r', 'p')
            cross join (values ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) as p(priv, cmd)
            where has_table_privilege('authenticated', c.oid, p.priv)
              and not exists (select 1 from pg_policy pl
                               where pl.polrelid = c.oid and pl.polcmd in ('*', p.cmd)
                                 and (pl.polroles = '{0}'::oid[] or 'authenticated'::regrole::oid = any (pl.polroles)))), 0,
  'authenticated holds no write privilege that has no matching RLS policy');
select ok(has_table_privilege('authenticated', 'public.bids', 'INSERT')
      and has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
      and has_table_privilege('authenticated', 'public.trucks', 'DELETE')
      and has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE'),
  'grants backed by a policy are kept');
select ok(has_table_privilege('authenticated', 'public.jobs', 'SELECT'), 'select grants are untouched');

-- Users -------------------------------------------------------------------------------
select set_config('t.cust',  tests.create_user('pc_cust')::text, true);
select set_config('t.drv',   tests.create_user('pc_drv', array['driver'])::text, true);
select set_config('t.admin', tests.create_user('pc_admin', array['admin'])::text, true);
select set_config('t.sup',   tests.create_user('pc_sup', array['super_admin'])::text, true);

-- Anonymous visitor -------------------------------------------------------------------
select tests.as_anon();
select throws_ok($$insert into public.profiles (id, full_name) values (gen_random_uuid(), 'x')$$, '42501', null, 'anon cannot insert a profile');
select throws_ok($$update public.jobs set status = status$$, '42501', null, 'anon cannot update jobs');
select throws_ok($$delete from public.bids$$, '42501', null, 'anon cannot delete bids');
select lives_ok($$select public.has_role(gen_random_uuid(), 'admin'::public.app_role)$$, 'anon can still call has_role');
select lives_ok($$select public.get_public_tracking(gen_random_uuid())$$, 'anon can still read public tracking');

-- Customer ------------------------------------------------------------------------------
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$update public.profiles set phone = '+263771234567' where id = %L$$, current_setting('t.cust')), 'customer updates own profile');
select is((select count(*)::int from public.profiles where id = auth.uid()), 1, 'customer reads own profile');
select throws_ok($$delete from public.jobs$$, '42501', null, 'customer cannot delete jobs');
select throws_ok($$insert into public.notifications (user_id, type, title, body) values (auth.uid(), 'x', 'x', 'x')$$, '42501', null, 'customer cannot write notifications');
select throws_ok($$truncate public.messages$$, '42501', null, 'customer cannot truncate');

-- Driver --------------------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$insert into public.trucks (driver_id, registration, capacity_m3) values (%L, 'PC 1234', 10)$$, current_setting('t.drv')),
  'driver adds a truck');
select lives_ok($$delete from public.push_subscriptions where user_id = auth.uid()$$, 'driver can still delete own push subscriptions');

-- Admin and super admin: still blocked from direct table writes, still reach audited functions ---
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select throws_ok($$delete from public.wallet_audit_log$$, '42501', null, 'super admin cannot rewrite the wallet audit log');
select lives_ok($$select public.admin_set_material_bucket_price('gravel', 10, 100, 120, 'privilege test')$$, 'super admin still uses audited price function');

select * from finish();
rollback;
