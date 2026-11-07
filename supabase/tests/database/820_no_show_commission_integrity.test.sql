-- 0147 financial integrity: the commission reserve through sweep -> reopen -> next driver.
--   * the sweep releases driver A's reserve once; reopening touches no wallet
--   * repeated release calls never change a wallet (no double release, no over-release of A's other reserves)
--   * driver B is reserved exactly once; repeated hold calls do nothing
--   * cancelling the reopened job releases B's reserve, A is untouched
--   * a job the customer cancelled by hand, even with the sweep's exact wording, cannot be reopened
begin;
select plan(12);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('nsc_cust')::text, true);
select set_config('t.a', tests.create_driver('nsc_a', 500, true)::text, true);
select set_config('t.b', tests.create_driver('nsc_b', 500, true)::text, true);

create or replace function pg_temp.held(_u text) returns numeric language sql as $$
  select held from public.wallets where user_id = current_setting('t.' || _u)::uuid $$;
create or replace function pg_temp.jheld(_j text) returns numeric language sql as $$
  select held_commission from public.jobs where id = current_setting('t.' || _j)::uuid $$;
create or replace function pg_temp.accept(_j text, _d text) returns void language plpgsql as $$
declare _b uuid;
begin
  perform tests.as_owner();
  _b := tests.create_bid(current_setting('t.' || _j)::uuid, current_setting('t.' || _d)::uuid, 100);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_b);
  perform tests.as_owner();
end $$;

-- driver A already has an unrelated 5.00 reserved: it must survive everything below
update public.wallets set held = 5 where user_id = current_setting('t.a')::uuid;

select set_config('t.j', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select pg_temp.accept('j', 'a');
select ok(pg_temp.jheld('j') > 0 and pg_temp.held('a') = 5 + pg_temp.jheld('j'),
  'accepting reserves the commission once on driver A (on top of the other 5.00)');

alter table public.jobs disable trigger t_jobs_updated;
update public.jobs set updated_at = now() - interval '30 hours' where id = current_setting('t.j')::uuid;
alter table public.jobs enable trigger t_jobs_updated;
select tests.as_service();
select public.expire_stale_accepted_jobs();
select tests.as_owner();
select is(pg_temp.held('a'), 5::numeric, 'the sweep released exactly this job''s reserve from driver A');
select ok(pg_temp.jheld('j') is null, 'and cleared the job''s reserve record');

select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j')), 'the customer reopens the job');
select tests.as_owner();
select is(pg_temp.held('a'), 5::numeric, 'reopening changed no wallet');

select tests.as_service();
select public.release_job_commission(current_setting('t.j')::uuid);
select public.release_job_commission(current_setting('t.j')::uuid);
select tests.as_owner();
select is(pg_temp.held('a'), 5::numeric, 'repeated release calls cannot release driver A''s other reserve');

select pg_temp.accept('j', 'b');
select ok(pg_temp.jheld('j') > 0 and pg_temp.held('b') = pg_temp.jheld('j'), 'the next driver is reserved once, for this job');
select is(pg_temp.held('a'), 5::numeric, 'driver A is untouched by the next acceptance');
select tests.as_service();
select public.hold_job_commission(current_setting('t.j')::uuid);
select tests.as_owner();
select ok(pg_temp.held('b') = pg_temp.jheld('j'), 'a repeated hold does not reserve twice');

select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j')::uuid, 'changed my mind');
select tests.as_owner();
select ok(pg_temp.held('b') = 0 and pg_temp.jheld('j') is null, 'cancelling the reopened job releases driver B''s reserve');
select is(pg_temp.held('a'), 5::numeric, 'and still does not touch driver A');

-- a hand-cancelled job cannot pass as a no-show, even with the sweep's exact wording
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select pg_temp.accept('j2', 'a');
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j2')::uuid, 'Driver did not start pickup within 24 hours of accepting');
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j2')), null, null,
  'a customer-cancelled job with the sweep wording cannot be reopened');
select tests.as_owner();

select * from finish();
rollback;
