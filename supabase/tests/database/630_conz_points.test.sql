-- 0131: ConZ points are off until approved, awarded once per verified delivery from the job's own
-- snapshot, readable only by their owner, adjustable only with a reason, and never touch money.
begin;
select plan(33);
select tests.enable_launch_features();

select set_config('t.c1',   tests.create_user('pt_c1')::text, true);
select set_config('t.c2',   tests.create_user('pt_c2')::text, true);
select set_config('t.drv',  tests.create_driver('pt_drv', 100)::text, true);
select set_config('t.admin', tests.create_user('pt_admin', array['admin'])::text, true);
select set_config('t.sup',  tests.create_user('pt_sup', array['super_admin'])::text, true);
select set_config('t.rdrv', tests.create_driver('pt_rdrv', 100)::text, true);

create function pg_temp.done(_cust uuid, _material text, _qty numeric, _price numeric, _days_ago int default 0) returns uuid
language plpgsql as $$
declare _j uuid;
begin
  _j := tests.create_job(_cust, 200, 'direct', 'custom', _qty);  -- 'custom' skips the price-range check on insert
  update public.jobs set material = _material::public.material_category,
         budget = (public.compute_material_offer(_material::public.material_category, _qty, 15)->>'offer')::numeric, status = 'completed', driver_id = current_setting('t.drv')::uuid, final_price = _price,
         completed_at = now() - (_days_ago || ' days')::interval where id = _j;
  return _j;
end $$;

-- 1. Safe defaults
select tests.as_owner();
select is((select value #>> '{}' from public.system_settings where key = 'points_enabled'), 'false', 'points are off by default');
select is((select count(*)::int from public.points_rules where not active and points_flat = 0 and points_per_m3 = 0 and points_per_usd = 0), 4,
  'the four starter rules are inactive with zero points');

-- jobs
select set_config('t.j1', pg_temp.done(current_setting('t.c1')::uuid, 'river_sand', 12, 200)::text, true);
select set_config('t.j2', pg_temp.done(current_setting('t.c1')::uuid, 'gravel', 12, 300)::text, true);
select set_config('t.j3', tests.create_job(current_setting('t.c1')::uuid, 200, 'direct')::text, true);
update public.jobs set status = 'cancelled' where id = current_setting('t.j3')::uuid;
select set_config('t.j4', pg_temp.done(current_setting('t.c2')::uuid, 'river_sand', 12, 100)::text, true);
update public.jobs set delivered_quantity_m3 = 8 where id = current_setting('t.j4')::uuid;
select set_config('t.j5', pg_temp.done(current_setting('t.c2')::uuid, 'river_sand', 12, 100)::text, true);
insert into public.disputes (job_id, raised_by, against, reason, category, status)
values (current_setting('t.j5')::uuid, current_setting('t.c2')::uuid, current_setting('t.drv')::uuid, 'test', 'other', 'open');
select set_config('t.j6', pg_temp.done(current_setting('t.c2')::uuid, 'river_sand', 12, 100, 3)::text, true);

-- 2. Off: nothing is awarded
select is(public.process_points(), 0, 'off: the processor awards nothing');
-- 3. On but no approved values: still nothing, and nothing is invented
update public.system_settings set value = 'true'::jsonb where key = 'points_enabled';
select is(public.process_points(), 0, 'on, but the starter rules are inactive: nothing is awarded');

-- 4. Approved values (rules set the way a super admin would)
update public.points_rules set active = true, points_flat = 10, points_per_m3 = 1 where event = 'delivery' and audience = 'customer' and material is null;
update public.points_rules set active = true, points_per_usd = 0.1 where event = 'delivery' and audience = 'driver' and material is null;
insert into public.points_rules (event, audience, material, points_flat, active) values ('delivery', 'customer', 'gravel', 50, true);
update public.points_rules set starts_at = now() - interval '1 day' where event = 'delivery' and material is null;
select public.process_points();
select is((select points from public.points_ledger where job_id = current_setting('t.j1')::uuid and user_id = current_setting('t.c1')::uuid), 22,
  'customer: 10 flat + 1 per m³ x 12 m³');
select is((select points from public.points_ledger where job_id = current_setting('t.j1')::uuid and user_id = current_setting('t.drv')::uuid), 20,
  'driver: 0.1 per USD of the job price (200)');
select is((select points from public.points_ledger where job_id = current_setting('t.j2')::uuid and user_id = current_setting('t.c1')::uuid), 50,
  'a product-specific rule (gravel) replaces the general rule');
select is((select count(*)::int from public.points_ledger where job_id = current_setting('t.j3')::uuid), 0, 'a cancelled job earns nothing');
select is((select points from public.points_ledger where job_id = current_setting('t.j4')::uuid and user_id = current_setting('t.c2')::uuid), 18,
  'the delivered quantity (8 m³) is used, not the ordered 12 m³');
select is((select count(*)::int from public.points_ledger where job_id = current_setting('t.j5')::uuid), 0, 'a job with an open dispute earns nothing');
select is((select count(*)::int from public.points_ledger where job_id = current_setting('t.j6')::uuid), 0,
  'a job completed before the rule started is not back-filled');

-- 5. Idempotent, and history is not recalculated
select is(public.process_points(), 0, 'a second run awards nothing new');
update public.material_prices set min_price = min_price + 5, max_price = max_price + 5 where material = 'river_sand';
update public.points_rules set points_flat = 99 where event = 'delivery' and audience = 'customer' and material is null;
select is(public.process_points(), 0, 'a price or rule change does not create new awards for old jobs');
select is((select points from public.points_ledger where job_id = current_setting('t.j1')::uuid and user_id = current_setting('t.c1')::uuid), 22,
  'the earlier award is unchanged');
select is((select (basis ->> 'job_price_usd')::numeric from public.points_ledger where job_id = current_setting('t.j1')::uuid limit 1), 200::numeric,
  'the award records the job price as it was');

-- 6. Privacy and write protection
select tests.login_as(current_setting('t.c1')::uuid);
select ok((select count(*) from public.points_ledger) = 2 and (select count(*) from public.points_ledger where user_id <> auth.uid()) = 0,
  'a customer reads only their own points');
select throws_ok($$insert into public.points_ledger (user_id, points, kind, idempotency_key) values (auth.uid(), 1000, 'adjustment', 'x')$$,
  '42501', null, 'a customer cannot write points');
select throws_ok($$select public.process_points()$$, '42501', null, 'a customer cannot run the processor');
select throws_ok(format($$select public.admin_adjust_points(%L, 5, 'free points please')$$, current_setting('t.c1')),
  '42501', null, 'a customer cannot adjust points');
select is((public.points_overview() ->> 'balance')::int, 72, 'points_overview shows the balance (22 + 50)');

-- 7. Admin adjustments and reversals
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_adjust_points(%L, 5, 'no')$$, current_setting('t.c2')), '22023', null, 'a reason is required');
select throws_ok(format($$select public.admin_adjust_points(%L, -500, 'remove points')$$, current_setting('t.c2')), '22023', null,
  'the balance cannot go below zero');
select lives_ok(format($$select public.admin_adjust_points(%L, 30, 'goodwill after a late delivery')$$, current_setting('t.c2')),
  'an admin can add points with a reason');
select throws_ok(format($$select public.admin_reverse_points(%L, 'x')$$, (select id from public.points_ledger where job_id = current_setting('t.j1')::uuid limit 1)),
  '22023', null, 'a reversal needs a reason too');
select lives_ok(format($$select public.admin_reverse_points(%L, 'delivery was disputed later')$$, (select id from public.points_ledger where job_id = current_setting('t.j1')::uuid and user_id = current_setting('t.c1')::uuid)),
  'an admin can reverse an award');
select throws_ok(format($$select public.admin_reverse_points(%L, 'second reversal attempt')$$, (select id from public.points_ledger where job_id = current_setting('t.j1')::uuid and user_id = current_setting('t.c1')::uuid and kind = 'award')),
  '22023', null, 'an entry can be reversed only once');
select throws_ok(format($$select public.admin_save_points_rule(null, 'delivery', 'customer', null, 1, 0, 0, false, null, null, 'admins cannot set policy')$$),
  '42501', null, 'an ordinary admin cannot change rules (super admin only)');

-- Rules: super admin + step-up, products must exist in Product Setup, one active rule per slot
select tests.as_owner();
select tests.login_as_mfa(current_setting('t.sup')::uuid);
select lives_ok($$select public.admin_save_points_rule(null, 'delivery', 'customer', 'stones', 5, 0, 0, false, null, null, 'draft stones rule')$$,
  'a super admin with a step-up can save a rule for a product that is set up');
select throws_ok($$select public.admin_save_points_rule(null, 'delivery', 'customer', null, 5, 0, 0, true, null, null, 'second general rule')$$,
  '22023', null, 'two active rules for the same slot are refused');

-- 8. History and money are untouched
select tests.as_owner();
select throws_ok($$update public.points_ledger set points = 1$$, '42501', null, 'the ledger is append-only');
select is((select count(*)::int from public.points_ledger where kind = 'reversal'), 1, 'the reversal is a new row; the award stays');
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 100.00::numeric, 'driver wallet unchanged by points');
select is((select value #>> '{}' from public.system_settings where key = 'commission_rate'), '7', 'the 7% commission is untouched');

select * from finish();
rollback;
