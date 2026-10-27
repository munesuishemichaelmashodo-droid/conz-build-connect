-- 0119: an offer's message is at most 500 characters.
begin;
select plan(4);
select tests.enable_launch_features();

select set_config('t.customer', tests.create_user('cust119')::text, true);
select set_config('t.driver',   tests.create_driver('drv119', 100)::text, true);
select set_config('t.job1', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);
select set_config('t.job2', tests.create_job(current_setting('t.customer')::uuid, 400)::text, true);

select tests.login_as(current_setting('t.driver')::uuid);

select lives_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id, message) values (%L, %L, 380, %L, %L)$$,
         current_setting('t.job1'), current_setting('t.driver'),
         tests.truck_of(current_setting('t.driver')::uuid), repeat('a', 500)),
  'a 500-character message is accepted');

select throws_ok(
  format($$insert into public.bids (job_id, driver_id, price, truck_id, message) values (%L, %L, 380, %L, %L)$$,
         current_setting('t.job2'), current_setting('t.driver'),
         tests.truck_of(current_setting('t.driver')::uuid), repeat('a', 501)),
  '23514', null, 'a 501-character message is rejected');

select throws_ok(
  format($$update public.bids set message = %L where job_id = %L and driver_id = %L$$,
         repeat('b', 2000), current_setting('t.job1'), current_setting('t.driver')),
  '23514', null, 'editing an offer to a 2000-character message is rejected');

select lives_ok(
  format($$update public.bids set message = null where job_id = %L and driver_id = %L$$,
         current_setting('t.job1'), current_setting('t.driver')),
  'clearing the message is allowed');

select * from finish();
rollback;
