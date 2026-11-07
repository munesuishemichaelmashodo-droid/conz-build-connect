-- 0144: a driver cannot hold two accepted/in-progress jobs at once (Harare pilot).
-- Every way of assigning a driver (accept_bid, accept_counter, accept_dispatch_offer) ends in the same
-- UPDATE of jobs.status to 'accepted', so the rule is a trigger on that UPDATE. The check takes a
-- per-driver advisory lock so two customers accepting the same driver at the same moment cannot both win.
begin;
select plan(12);
select tests.enable_launch_features();

select set_config('t.c1', tests.create_user('one_c1')::text, true);
select set_config('t.c2', tests.create_user('one_c2')::text, true);
select set_config('t.c3', tests.create_user('one_c3')::text, true);
select set_config('t.d',  tests.create_driver('one_d', 100)::text, true);
select set_config('t.d2', tests.create_driver('one_d2', 100)::text, true);

-- An open job with one pending offer from a driver. The bid id goes to t.bid_<tag>.
create or replace function pg_temp.offer(_cust uuid, _driver uuid, _tag text) returns uuid
language plpgsql as $$
declare _j uuid; _b uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(_cust, 100, 'direct');
  _b := tests.create_bid(_j, _driver, 100);
  perform set_config('t.bid_' || _tag, _b::text, true);
  perform set_config('t.job_' || _tag, _j::text, true);
  return _j;
end $$;

create or replace function pg_temp.jstatus(_tag text) returns text language sql as $$
  select status::text from public.jobs where id = current_setting('t.job_' || _tag)::uuid
$$;

-- 1. The first acceptance works.
select pg_temp.offer(current_setting('t.c1')::uuid, current_setting('t.d')::uuid, 'a');
select tests.login_as(current_setting('t.c1')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_a')), 'a driver with no active job can be accepted');

-- 2-3. A second acceptance of the same driver is refused, and nothing is half-done.
select pg_temp.offer(current_setting('t.c2')::uuid, current_setting('t.d')::uuid, 'b');
select tests.login_as(current_setting('t.c2')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.bid_b')), '%DRIVER_BUSY%',
  'accept_bid: a driver already on an accepted job cannot be accepted again');
select tests.as_owner();
select ok(pg_temp.jstatus('b') = 'open'
          and (select status::text from public.bids where id = current_setting('t.bid_b')::uuid) = 'pending',
  'the refused acceptance changes nothing: the job is still open and the offer still pending');

-- 4. Still blocked while the first job is in progress.
update public.jobs set status = 'in_progress' where id = current_setting('t.job_a')::uuid;
select tests.login_as(current_setting('t.c2')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.bid_b')), '%DRIVER_BUSY%',
  'an in-progress job blocks a new acceptance too');

-- 5. The counter-offer path follows the same rule.
select pg_temp.offer(current_setting('t.c3')::uuid, current_setting('t.d')::uuid, 'c');
select tests.login_as(current_setting('t.c3')::uuid);
select lives_ok(format($$select public.counter_bid(%L, 80)$$, current_setting('t.bid_c')), 'customer sends a counter-offer');
select tests.login_as(current_setting('t.d')::uuid);
select throws_like(format($$select public.accept_counter(%L)$$, current_setting('t.bid_c')), '%DRIVER_BUSY%',
  'accept_counter: the busy driver cannot take a second job by accepting a counter-offer');

-- 6. The dispatch path (accept_dispatch_offer) ends in this same update.
select tests.as_owner();
select throws_like(format($$update public.jobs set status = 'accepted', driver_id = %L where id = %L$$,
                          current_setting('t.d'), current_setting('t.job_b')),
  '%DRIVER_BUSY%', 'assigning a busy driver directly (as the dispatch path does) is refused');

-- 7. Another driver is not affected.
select pg_temp.offer(current_setting('t.c2')::uuid, current_setting('t.d2')::uuid, 'g');
select tests.login_as(current_setting('t.c2')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_g')), 'a different driver with no active job can be accepted');

-- 8. Saving the same accepted job again never blocks itself.
select tests.as_owner();
select lives_ok(format($$update public.jobs set notes = 'still mine' where id = %L$$, current_setting('t.job_g')),
  'updating a driver''s own accepted job is not blocked by that same job');

-- 9. A completed job frees the driver.
update public.jobs set status = 'completed', completed_at = now() where id = current_setting('t.job_a')::uuid;
select pg_temp.offer(current_setting('t.c1')::uuid, current_setting('t.d')::uuid, 'e');
select tests.login_as(current_setting('t.c1')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_e')),
  'once the first job is completed the driver can be accepted for a new one');

-- 10. A cancelled job frees the driver (and legacy double-active rows never brick a running job).
select tests.as_owner();
update public.jobs set status = 'cancelled' where id = current_setting('t.job_e')::uuid;
select pg_temp.offer(current_setting('t.c1')::uuid, current_setting('t.d')::uuid, 'f');
select tests.login_as(current_setting('t.c1')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_f')),
  'a cancelled job does not keep the driver busy');

-- 11. Rows that were already double-booked before this rule keep working.
select tests.as_owner();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
update public.jobs set status = 'accepted', driver_id = current_setting('t.d')::uuid where id = current_setting('t.job_b')::uuid;
alter table public.jobs enable trigger trg_jobs_one_active_per_driver;
select lives_ok(format($$update public.jobs set status = 'in_progress' where id = %L$$, current_setting('t.job_b')),
  'an already double-booked driver can still progress their running jobs (only NEW acceptances are checked)');

select * from finish();
rollback;
