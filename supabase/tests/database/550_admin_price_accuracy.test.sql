-- 0123: admin price accuracy report.
begin;
select plan(6);
select set_config('t.cust',  tests.create_user('pa_cust')::text, true);
select set_config('t.drv',   tests.create_driver('pa_drv', 0)::text, true);
select set_config('t.admin', tests.create_user('pa_admin', array['admin'])::text, true);

-- Two accepted gravel jobs: estimate 200 -> accepted 230 (+15%), estimate 300 -> accepted 300 (0%).
create or replace function pg_temp.job(_est numeric, _final numeric, _status text default 'completed') returns void
language plpgsql as $$
declare _j uuid;
begin
  _j := tests.create_job(current_setting('t.cust')::uuid, 200, 'direct', 'gravel');
  update public.jobs set pricing_breakdown = jsonb_build_object('recommended', _est),
         final_price = _final, driver_id = current_setting('t.drv')::uuid, status = _status::public.job_status
   where id = _j;
end $$;
select tests.as_owner();
select pg_temp.job(200, 230);
select pg_temp.job(300, 300, 'accepted');
select pg_temp.job(250, 100, 'cancelled');   -- cancelled jobs don't count

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select * from public.admin_price_accuracy(180)$$, '42501', null, 'customers cannot read the report');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$select * from public.admin_price_accuracy(180)$$, '42501', null, 'drivers cannot read the report');

select tests.login_as(current_setting('t.admin')::uuid);
select is((select jobs from public.admin_price_accuracy(180) where material = 'gravel'), 2,
          'admins see accepted/completed jobs only');
select is((select median_estimate from public.admin_price_accuracy(180) where material = 'gravel'), 250.00::numeric,
          'median estimate');
select is((select median_gap_pct from public.admin_price_accuracy(180) where material = 'gravel'), 7.5::numeric,
          'median gap between accepted price and estimate, in %');
select is((select within_15_pct from public.admin_price_accuracy(180) where material = 'gravel'), 2,
          'how many accepted prices landed within 15% of the estimate');

select * from finish();
rollback;
