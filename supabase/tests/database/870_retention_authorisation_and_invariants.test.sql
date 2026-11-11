-- 0148-0151 boundary checks, in one place:
--   * delivery evidence and completion cannot be recorded or confirmed by an unauthorised actor
--   * the new retention paths (cancellation reasons, feedback, metrics, notification text) never move money:
--     driver wallets, held commission, wallet transactions and payments are identical before and after
begin;
select plan(14);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('ra_cust')::text, true);
select set_config('t.other', tests.create_user('ra_other')::text, true);
select set_config('t.admin', tests.create_user('ra_admin', array['admin'])::text, true);
select set_config('t.da',    tests.create_driver('ra_da', 200, true)::text, true);
select set_config('t.db',    tests.create_driver('ra_db', 200, true)::text, true);

-- an in-progress direct-pay job for driver A, with a commission reserve
select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
do $$
declare b uuid;
begin
  b := tests.create_bid(current_setting('t.job')::uuid, current_setting('t.da')::uuid, 100);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(b);
  perform tests.as_owner();
  update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
end $$;

-- 1-3 evidence
select tests.login_as(current_setting('t.db')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'delivery', 'x/y.jpg')$$, current_setting('t.job')), null, null, 'a driver who is not on the job cannot record evidence for it');
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format($$select public.record_job_evidence(%L, 'delivery', 'x/y.jpg')$$, current_setting('t.job')), null, null, 'an unrelated customer cannot record evidence for it');

-- 3-6 completion
select throws_ok(format($$select public.complete_job(%L)$$, current_setting('t.job')), null, null, 'an unrelated customer cannot complete the job');
select tests.login_as(current_setting('t.db')::uuid);
select throws_ok(format($$select public.complete_job(%L)$$, current_setting('t.job')), null, null, 'an unrelated driver cannot complete the job');
select throws_ok(format($$select public.driver_confirm_delivery_pin(%L, '000000')$$, current_setting('t.job')), null, null, 'an unrelated driver cannot confirm delivery with a PIN');
select tests.login_as(current_setting('t.da')::uuid);
select is((select public.get_my_delivery_pin(current_setting('t.job')::uuid)), null, 'the driver gets nothing when asking for the customer''s delivery PIN');
select tests.login_as(current_setting('t.cust')::uuid);
select ok((select public.get_my_delivery_pin(current_setting('t.job')::uuid)) is not null, 'the customer can read their own delivery PIN');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.job')::uuid), 'in_progress', 'none of the above changed the job');

-- 7-12 invariants: snapshot money state, exercise every new path, compare
create or replace function pg_temp.money() returns text language sql as $$
  select coalesce((select string_agg(user_id::text || ':' || balance::text || ':' || coalesce(held, 0)::text, ',' order by user_id) from public.wallets), '')
         || '|' || (select count(*) from public.wallet_transactions)::text
         || '|' || (select count(*) from public.payments)::text
         || '|' || coalesce((select held_commission::text from public.jobs where id = current_setting('t.job')::uuid), 'null')
$$;
select set_config('t.money', pg_temp.money(), true);

-- cancellation reason on a different, cancelled job (cancel_job itself is not what is under test here)
select set_config('t.jc', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.jc')::uuid, 'plans changed');
select tests.as_owner();
select set_config('t.money_after_cancel', pg_temp.money(), true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.record_cancellation_reason(current_setting('t.jc')::uuid, 'customer_changed_plans');
select tests.as_owner();
select is(pg_temp.money(), current_setting('t.money_after_cancel'), 'recording a cancellation reason moves no money');

-- feedback on a completed job
select set_config('t.jf', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
update public.jobs set status = 'completed', driver_id = current_setting('t.da')::uuid, final_price = 100 where id = current_setting('t.jf')::uuid;
select set_config('t.money_b', pg_temp.money(), true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.submit_delivery_feedback(current_setting('t.jf')::uuid, 'price_worked', 'ok');
select tests.as_owner();
select is(pg_temp.money(), current_setting('t.money_b'), 'submitting feedback moves no money');

-- metrics read
select tests.login_as(current_setting('t.admin')::uuid);
select public.admin_marketplace_metrics(30);
select tests.as_owner();
select is(pg_temp.money(), current_setting('t.money_b'), 'reading the metrics moves no money');

-- dispatch notification text does not change commission or wallets
select tests.as_service();
select public.create_dispatch_wave(current_setting('t.jc')::uuid, 5);
select tests.as_owner();
select is(pg_temp.money(), current_setting('t.money_b'), 'creating a dispatch wave (with the new notification text) moves no money');

-- the commission reserve of the in-progress job is untouched by all of it
select ok((select held_commission is not null from public.jobs where id = current_setting('t.job')::uuid), 'the in-progress job still holds its commission reserve');
select is((select count(*)::int from public.wallets where held < 0), 0, 'no wallet has a negative reserve');

select * from finish();
rollback;
