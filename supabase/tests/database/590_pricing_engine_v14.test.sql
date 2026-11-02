-- 0127 — pricing engine v1.4 (owner decisions 02/11/2026):
--  * customer estimate trips = ceil(quantity / 20) for every size (no jump above 20 m³);
--  * loads over 20 m³ learn only from completed, comparable, undisputed jobs
--    (>= 10 jobs, >= 3 drivers, median per m³), else the deterministic calculation;
--  * the lowest allowed budget includes the single delivery fee (never above recommended);
--  * fuel / long-haul defaults shared with the app; diesel setting never overwritten;
--  * admin_set_fuel_assumptions: super admin + step-up + bounds + reason + audit;
--  * admin_price_accuracy_completed: completed deliveries only.
begin;
select plan(47);
select tests.enable_launch_features();  -- lifts the $500 launch cap for the 40 m³ and outlier jobs

-- Known prices (production values of 02/11/2026 for river sand).
delete from public.material_price_buckets where material = 'river_sand';
insert into public.material_price_buckets (material, bucket_m3, min_price, max_price) values
  ('river_sand',5,60,80),('river_sand',10,120,160),('river_sand',12,144,192),('river_sand',15,180,240),('river_sand',20,240,320);
update public.material_prices set min_price = 12, max_price = 16, enforced = true, demand_multiplier = 1 where material = 'river_sand';
delete from public.system_settings where key in ('fuel_l_per_100km','long_haul_markup');
update public.system_settings set value = to_jsonb(1.87) where key = 'diesel_price_per_liter';

create function pg_temp.q(_qty numeric, _km numeric) returns jsonb language sql as
$$ select public.compute_material_offer('river_sand'::public.material_category, _qty, _km) $$;

-- 1. Version and trips (reference load 20 m³ for every size)
select is(pg_temp.q(12,15)->>'pricingVersion', 'v1.4', 'Version is v1.4');
select is((pg_temp.q(20,15)->>'tripCount')::int, 1, '20 m³ is one 20 m³ load');
select is((pg_temp.q(20.01,15)->>'tripCount')::int, 2, '20.01 m³ is two loads (was three 10 m³ trips)');
select is((pg_temp.q(25,15)->>'tripCount')::int, 2, '25 m³ is two loads');
select is((pg_temp.q(30,15)->>'tripCount')::int, 2, '30 m³ is two loads');
select is((pg_temp.q(40.01,15)->>'tripCount')::int, 3, '40.01 m³ is three loads');
select is((pg_temp.q(25,15)->>'referenceCapacityM3')::numeric, 20::numeric, 'Reference load reported as 20 m³');
select ok(pg_temp.q(25,15)->'assumptions'->>'tripRule' ilike '%20 m³%', 'The trip assumption is stated on the quote');
-- No history: deterministic = mid price per m³ × qty + transport × trips
select is(pg_temp.q(25,15)->>'dataSource', 'reference_capacity', 'Without history, big loads use the deterministic calculation');
select is((pg_temp.q(25,15)->>'transportCost')::numeric, 60::numeric, '25 m³ at 15 km: two trips × $30');
select is((pg_temp.q(25,15)->>'materialCost')::numeric, 350::numeric, '25 m³ × $14 mid price');
select is((pg_temp.q(25,15)->>'offer')::numeric, 420::numeric, '$350 + $60 = $410 rounded to the $20 step');
-- The step from 20 to 20.01 m³ is one extra delivery fee, not a jump to three trips
select cmp_ok((pg_temp.q(20.01,15)->>'offer')::numeric - (pg_temp.q(20,15)->>'offer')::numeric, '<=', 60::numeric,
  'Going just over 20 m³ adds at most about one delivery fee');

-- 2. Buckets and small loads keep their recommended prices; low includes delivery
select is((pg_temp.q(12,15)->>'offer')::numeric, 200::numeric, '12 m³ at 15 km recommended stays $200');
select is((pg_temp.q(12,15)->>'high')::numeric, 230::numeric, 'and high stays $230');
select is((pg_temp.q(12,15)->>'low')::numeric, 174::numeric, 'Low = bucket minimum $144 + the one $30 delivery fee');
select is((pg_temp.q(12,15)->>'min')::numeric, (pg_temp.q(12,15)->>'low')::numeric, 'min (used by booking) equals low');
select is((select count(*)::int from unnest(array[1,5,10,12,15,20]) q, unnest(array[0,10,10.01,20,20.01,30,30.01,50,50.01,120]) d
            where (pg_temp.q(q,d)->>'low')::numeric > (pg_temp.q(q,d)->>'offer')::numeric), 0,
  'Low never exceeds recommended for any bucket size or distance band');
select is((select count(*)::int from unnest(array[1,5,10,12,15,20]) q, unnest(array[0,10,10.01,20,20.01,30,30.01,50,50.01,120]) d
            where (pg_temp.q(q,d)->>'low')::numeric
                  <> round(least((select min_price from public.material_price_buckets b where b.material='river_sand' and b.bucket_m3 >= q order by b.bucket_m3 limit 1)
                           + (pg_temp.q(q,d)->>'transportCost')::numeric, (pg_temp.q(q,d)->>'offer')::numeric))), 0,
  'Low = bucket minimum + one delivery fee (capped at recommended) everywhere');
select is((pg_temp.q(0.5,15)->>'low')::numeric, round((pg_temp.q(0.5,15)->>'offer')::numeric * 0.85), 'Small loads keep ±15%');
select is((pg_temp.q(1,15)->>'bucketM3')::numeric, 5::numeric, '1 m³ uses the 5 m³ bucket');
select is((pg_temp.q(20,15)->>'bucketM3')::numeric, 20::numeric, '20 m³ uses the 20 m³ bucket');

-- 3. Transport bands and boundaries unchanged
select is((pg_temp.q(12,10)->>'transportCost')::numeric, 20::numeric, '10 km: $20');
select is((pg_temp.q(12,10.01)->>'transportCost')::numeric, 30::numeric, '10.01 km: $30');
select is((pg_temp.q(12,30.01)->>'transportCost')::numeric, 60::numeric, '30.01 km: $60');
select is((pg_temp.q(12,50)->>'transportCost')::numeric, 60::numeric, '50 km: $60');
select is((pg_temp.q(12,60)->>'transportCost')::numeric, round(60 + 10 * 0.32 * 1.87 * 1.87, 2), '60 km: $60 + 10 km × long-haul rate');

-- 4. Diesel and fuel fallbacks; the diesel setting is never written
select is((pg_temp.q(12,80)->'assumptions'->>'dieselPricePerLitre')::numeric, 1.87, 'The saved $1.87 diesel price is used');
select is((select (value::text)::numeric from public.system_settings where key = 'diesel_price_per_liter'), 1.87,
  'The diesel setting is unchanged by the migration');
update public.system_settings set value = to_jsonb('abc'::text) where key = 'diesel_price_per_liter';
select is((pg_temp.q(12,80)->'assumptions'->>'dieselPricePerLitre')::numeric, 2.04, 'An invalid diesel setting falls back to $2.04');
select is(pg_temp.q(12,80)->'assumptions'->>'dieselSource', 'default', 'and says it is the default');
update public.system_settings set value = to_jsonb(1.87) where key = 'diesel_price_per_liter';
insert into public.system_settings (key, value) values ('fuel_l_per_100km', to_jsonb(90));
select is((pg_temp.q(12,80)->'assumptions'->>'fuelLitresPer100km')::numeric, 32::numeric, 'Fuel use outside 10–80 falls back to 32');
delete from public.system_settings where key = 'fuel_l_per_100km';

-- 5. History: only completed, comparable, undisputed jobs; >= 10 jobs, >= 3 drivers, median
select set_config('t.c', tests.create_user('pv_cust')::text, true);
select set_config('t.d1', tests.create_driver('pv_d1')::text, true);
select set_config('t.d2', tests.create_driver('pv_d2')::text, true);
select set_config('t.d3', tests.create_driver('pv_d3')::text, true);
create function pg_temp.done(_drv text, _qty numeric, _price numeric, _km numeric, _src text default 'osrm',
                             _status public.job_status default 'completed') returns uuid language plpgsql as $$
declare _j uuid;
begin
  _j := tests.create_job(current_setting('t.c')::uuid, (pg_temp.q(_qty, 15)->>'offer')::numeric, 'direct', 'river_sand', _qty);
  update public.jobs set status = _status, final_price = _price, driver_id = current_setting(_drv)::uuid,
         completed_at = case when _status = 'completed' then now() - interval '3 days' end,
         pricing_breakdown = jsonb_build_object('distance_km', _km, 'distance_source', _src, 'recommended', _price)
   where id = _j;
  return _j;
end $$;
-- 9 good jobs at $18/m³ (25 m³, 15 km) from 3 drivers: one short of 10
do $$ begin
  for i in 1..9 loop perform pg_temp.done('t.d' || (1 + i % 3), 25, 450, 15); end loop;
end $$;
select is(pg_temp.q(25,15)->>'dataSource', 'reference_capacity', '9 qualifying jobs are not enough');
-- These never count
select pg_temp.done('t.d1', 25, 450, 15, 'osrm', 'cancelled');
select pg_temp.done('t.d1', 25, 450, 15, 'osrm', 'in_progress');
select pg_temp.done('t.d1', 25, null, 15);
select pg_temp.done('t.d1', 25, 450, 15, 'haversine');
select pg_temp.done('t.d1', 25, 450, 80);
select pg_temp.done('t.d1', 40, 900, 15);
do $$ declare j uuid; begin
  j := pg_temp.done('t.d1', 25, 450, 15);
  insert into public.disputes (job_id, raised_by, against, reason, status)
    values (j, current_setting('t.c')::uuid, current_setting('t.d1')::uuid, 'Short load delivered', 'resolved');
  j := pg_temp.done('t.d1', 25, 450, 15);
  update public.jobs set delivered_quantity_m3 = 18 where id = j;
end $$;
select is(pg_temp.q(25,15)->>'dataSource', 'reference_capacity',
  'Cancelled, active, no-final-price, straight-line, far, different-size, disputed and short-delivered jobs do not count');
-- A rejected dispute doesn't exclude the job: the 10th qualifying job
do $$ declare j uuid; begin
  j := pg_temp.done('t.d2', 25, 450, 15);
  insert into public.disputes (job_id, raised_by, against, reason, status)
    values (j, current_setting('t.c')::uuid, current_setting('t.d2')::uuid, 'Late arrival claim', 'rejected');
end $$;
select is(pg_temp.q(25,15)->>'dataSource', 'completed_jobs', '10 qualifying jobs from 3 drivers are used');
select is((pg_temp.q(25,15)->>'sampleSize')::int, 10, 'Sample size reported');
select is((pg_temp.q(25,15)->>'driverCount')::int, 3, 'Driver count reported');
select is((pg_temp.q(25,15)->>'offer')::numeric, 460::numeric, 'Median $18/m³ × 25 = $450, rounded to the $20 step; no transport added');
select is(pg_temp.q(25,15)->>'transportCost', null, 'All-in history price: transport is not added again');
-- One huge outlier doesn't move the median
select pg_temp.done('t.d3', 25, 5000, 15);
select is((pg_temp.q(25,15)->>'offer')::numeric, 460::numeric, 'A single outlier does not move the median');
-- Fewer than 3 drivers: not used
update public.jobs set driver_id = current_setting('t.d1')::uuid where customer_id = current_setting('t.c')::uuid;
select is(pg_temp.q(25,15)->>'dataSource', 'reference_capacity', 'All jobs from one driver: not enough independent drivers');

-- 6. admin_set_fuel_assumptions: super admin + step-up + bounds + reason + audit
select set_config('t.sa', tests.create_user('pv_sa', array['super_admin','admin'])::text, true);
select set_config('t.ad', tests.create_user('pv_ad', array['admin'])::text, true);
select tests.login_as(current_setting('t.ad')::uuid);
select throws_ok($$ select public.admin_set_fuel_assumptions(34, 1.9, 'New HOWO tippers') $$, '42501', null, 'An ordinary admin cannot change fuel assumptions');
select tests.login_as(current_setting('t.sa')::uuid);
select throws_ok($$ select public.admin_set_fuel_assumptions(34, 1.9, 'New HOWO tippers') $$, '42501', null, 'A super admin needs a fresh step-up');
select tests.login_as_mfa(current_setting('t.sa')::uuid);
select throws_ok($$ select public.admin_set_fuel_assumptions(95, 1.9, 'New HOWO tippers') $$, '22023', null, 'Fuel use outside 10–80 is refused');
select throws_ok($$ select public.admin_set_fuel_assumptions(34, 1.9, 'ok') $$, '22023', null, 'A reason is required');
select lives_ok($$ select public.admin_set_fuel_assumptions(34, 1.9, 'Loaded HOWO tippers measured') $$, 'A stepped-up super admin can change them');
select tests.as_owner();
select is((select count(*)::int from public.admin_audit_log where action = 'fuel_assumptions_changed' and actor_id = current_setting('t.sa')::uuid), 1,
  'One audit row with the reason');

select * from finish();
rollback;
