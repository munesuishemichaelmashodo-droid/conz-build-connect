-- 0149: optional post-delivery feedback ("What mattered most about this delivery?").
--   * only the job's customer, only after the job is completed
--   * one response per job; dismissing is recorded so the prompt is not repeated
--   * valid answers only; short optional comment; no direct client writes; no cross-account reads
--   * submitting never changes the job, its payment arrangement or the driver's commission reserve
begin;
select plan(18);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('fb_cust')::text, true);
select set_config('t.other', tests.create_user('fb_other')::text, true);
select set_config('t.drv',   tests.create_driver('fb_drv', 100)::text, true);

create or replace function pg_temp.job(_tag text, _status text) returns uuid language plpgsql as $$
declare _j uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 100, 'direct');
  update public.jobs set status = _status::job_status, driver_id = current_setting('t.drv')::uuid, final_price = 100,
         held_commission = 7
   where id = _j;
  perform set_config('t.j_' || _tag, _j::text, true);
  return _j;
end $$;
create or replace function pg_temp.submit(_tag text, _answer text, _comment text default null) returns void language sql as $$
  select public.submit_delivery_feedback(current_setting('t.j_' || _tag)::uuid, _answer, _comment) $$;

select pg_temp.job('done', 'completed');
select pg_temp.job('open', 'accepted');
select pg_temp.job('prog', 'in_progress');

-- 1-3 the customer answers a completed job
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select pg_temp.submit('done', 'price_worked', '  Fair and on time.  ')$$, 'the customer can answer after a completed delivery');
select is((select answer from public.delivery_feedback where job_id = current_setting('t.j_done')::uuid), 'price_worked', 'the answer is stored');
select is((select comment from public.delivery_feedback where job_id = current_setting('t.j_done')::uuid), 'Fair and on time.', 'the optional comment is stored, trimmed');

-- 4 one response per job
select throws_ok($$select pg_temp.submit('done', 'delivery_quick')$$, null, null, 'a second response for the same job is refused');

-- 5-6 only the job's customer
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok($$select pg_temp.submit('done', 'other')$$, null, null, 'another customer cannot answer for this job');
select is((select count(*)::int from public.delivery_feedback), 0, 'and cannot read someone else''s feedback');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$select pg_temp.submit('done', 'other')$$, null, null, 'the driver cannot answer for the customer');

-- 7-8 only completed jobs
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select pg_temp.submit('open', 'other')$$, null, null, 'an accepted (not completed) job cannot get feedback');
select throws_ok($$select pg_temp.submit('prog', 'other')$$, null, null, 'a job in progress cannot get feedback');

-- 9-11 validation
select pg_temp.job('v', 'completed');
select throws_ok($$select pg_temp.submit('v', 'made_up')$$, null, null, 'an unknown answer is refused');
select throws_ok($$select pg_temp.submit('v', null)$$, null, null, 'a missing answer is refused');
select throws_ok($$select pg_temp.submit('v', 'other', repeat('x', 281))$$, null, null, 'a comment over 280 characters is refused');

-- 12-14 dismissing records the choice and does not block a later answer
select pg_temp.job('d', 'completed');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select public.dismiss_delivery_feedback(current_setting('t.j_d')::uuid)$$, 'the customer can dismiss the prompt');
select lives_ok($$select public.dismiss_delivery_feedback(current_setting('t.j_d')::uuid)$$, 'dismissing twice is harmless');
select is((select count(*)::int from public.delivery_feedback where job_id = current_setting('t.j_d')::uuid and dismissed), 1, 'one dismissed record exists, so the prompt is not repeated');

-- 15 clients cannot write the table directly
do $$ begin
  insert into public.delivery_feedback (job_id, customer_id, answer) values (current_setting('t.j_v')::uuid, current_setting('t.cust')::uuid, 'other');
exception when others then null;
end $$;
select tests.as_owner();
select is((select count(*)::int from public.delivery_feedback where job_id = current_setting('t.j_v')::uuid), 0, 'a direct client insert has no effect');

-- 16-17 feedback never touches the job or the commission reserve
select is((select status::text || '/' || payment_method || '/' || held_commission::text from public.jobs where id = current_setting('t.j_done')::uuid),
  'completed/direct/7.00', 'submitting feedback leaves the job, payment method and commission reserve unchanged');

-- 18 anonymous callers are refused
select tests.as_anon();
select throws_ok($$select pg_temp.submit('done', 'other')$$, null, null, 'anonymous callers cannot submit');
select tests.as_owner();

select * from finish();
rollback;
