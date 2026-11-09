-- 0155: nobody writing straight to the jobs table from a client session (customer, driver or admin) can change a
-- money or assignment column. The job actions (functions) still work. Closes audit findings M1 (admin direct write)
-- and H1 (held_commission_promo writable by the driver or customer).
begin;
select plan(16);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('mg_cust')::text, true);
select set_config('t.admin', tests.create_user('mg_admin', array['admin'])::text, true);
select set_config('t.d',     tests.create_driver('mg_d', 200, true)::text, true);

select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
do $$
declare b uuid;
begin
  b := tests.create_bid(current_setting('t.job')::uuid, current_setting('t.d')::uuid, 100);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(b);
  perform tests.as_owner();
end $$;

-- admin
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$update public.jobs set status = 'completed' where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot set the status directly');
select throws_ok(format($$update public.jobs set final_price = 1 where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot set the price directly');
select throws_ok(format($$update public.jobs set held_commission = 0 where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot clear the reserve directly');
select throws_ok(format($$update public.jobs set commission = 0 where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot set the commission directly');
select lives_ok(format($$update public.jobs set notes = 'checked by admin' where id = %L$$, current_setting('t.job')), 'an admin can still edit non-money fields');

select throws_ok(format($$update public.jobs set budget = 1 where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot change the budget directly');
select throws_ok(format($$update public.jobs set delivery_pin = 'x' where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot rewrite the delivery PIN directly');
select throws_ok(format($$update public.jobs set cancelled_at = now() where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot stamp a cancellation directly');
select throws_ok(format($$update public.jobs set delivery_photo_taken_at = now() where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot move the photo time that starts the auto-release clock');
select throws_ok(format($$update public.jobs set driver_id = null where id = %L$$, current_setting('t.job')), '42501', null, 'an admin cannot unassign the driver directly');

-- driver and customer on the promo column (present in this build)
select tests.login_as(current_setting('t.d')::uuid);
select throws_ok(format($$update public.jobs set held_commission_promo = 5000 where id = %L$$, current_setting('t.job')), '42501', null, 'the driver cannot write the promo reserve');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$update public.jobs set held_commission_promo = 5000 where id = %L$$, current_setting('t.job')), '42501', null, 'the customer cannot write the promo reserve');

-- the job actions still work and are not blocked by the guard
select lives_ok(format($$select public.cancel_job(%L, 'plans changed')$$, current_setting('t.job')), 'the customer can still cancel through the job action');
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), null, 'which released the reserve');
select is((select status::text from public.jobs where id = current_setting('t.job')::uuid), 'cancelled', 'and cancelled the job');
-- the owner role (server side, migrations) is not limited
select lives_ok(format($$update public.jobs set final_price = final_price where id = %L$$, current_setting('t.job')), 'server-side writes are not limited');

select * from finish();
rollback;
