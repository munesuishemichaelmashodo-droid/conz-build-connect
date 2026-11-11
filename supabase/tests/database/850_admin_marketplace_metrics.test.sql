-- 0150: admin marketplace metrics (aggregate, admin only, no identifiers) + no-show reopening tracking.
-- Counts are checked as DELTAS around known fixtures, so the test does not depend on other data.
--   * jobs are counted as jobs, offers as offers (separate sections); system exclusion rows (wave 0) are not offers
--   * repeat = a request/delivery from a customer with an EARLIER completed delivery
--   * a reopened request is counted as a reopening, never as a new request
begin;
select plan(19);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.c1',    tests.create_user('mm_c1')::text, true);
select set_config('t.c2',    tests.create_user('mm_c2')::text, true);
select set_config('t.admin', tests.create_user('mm_admin', array['admin'])::text, true);
select set_config('t.d1',    tests.create_driver('mm_d1', 100)::text, true);
select set_config('t.d2',    tests.create_driver('mm_d2', 100)::text, true);

create or replace function pg_temp.m(_path text[]) returns numeric language plpgsql as $$
declare r jsonb; v text;
begin
  perform tests.login_as(current_setting('t.admin')::uuid);
  r := public.admin_marketplace_metrics(7);
  perform tests.as_owner();
  v := r #>> _path;
  return coalesce(v::numeric, 0);
end $$;

-- before snapshot
select set_config('t.b_req',    pg_temp.m('{jobs,requests_created}')::text, true);
select set_config('t.b_offn',   pg_temp.m('{jobs,with_offer,n}')::text, true);
select set_config('t.b_offd',   pg_temp.m('{jobs,offer_accepted,d}')::text, true);
select set_config('t.b_acc',    pg_temp.m('{jobs,offer_accepted,n}')::text, true);
select set_config('t.b_done',   pg_temp.m('{jobs,verified_completed,n}')::text, true);
select set_config('t.b_canc',   pg_temp.m('{jobs,cancelled,n}')::text, true);
select set_config('t.b_price',  pg_temp.m('{jobs,cancelled_by_reason,price_too_high}')::text, true);
select set_config('t.b_unk',    pg_temp.m('{jobs,cancelled_by_reason,unknown}')::text, true);
select set_config('t.b_noshow', pg_temp.m('{jobs,no_shows,n}')::text, true);
select set_config('t.b_reop',   pg_temp.m('{jobs,no_show_reopened,reopened}')::text, true);
select set_config('t.b_reopd',  pg_temp.m('{jobs,no_show_reopened,reopened_then_completed}')::text, true);
select set_config('t.b_rrq',    pg_temp.m('{jobs,repeat_requests,n}')::text, true);
select set_config('t.b_rdone',  pg_temp.m('{jobs,repeat_verified_completed,n}')::text, true);
select set_config('t.b_inv',    pg_temp.m('{jobs,invited,n}')::text, true);
select set_config('t.b_invch',  pg_temp.m('{jobs,invited_chosen,n}')::text, true);
select set_config('t.b_fbans',  pg_temp.m('{feedback,answered}')::text, true);
select set_config('t.b_fbp',    pg_temp.m('{feedback,by_answer,price_worked}')::text, true);
select set_config('t.b_osent',  pg_temp.m('{offers,sent}')::text, true);
select set_config('t.b_oview',  pg_temp.m('{offers,viewed}')::text, true);
select set_config('t.b_odecl',  pg_temp.m('{offers,declined}')::text, true);
select set_config('t.b_oexp',   pg_temp.m('{offers,expired}')::text, true);

-- fixtures (all created now, so inside the 7 day window)
create or replace function pg_temp.job(_tag text, _cust text, _status text, _created interval default '0') returns uuid
language plpgsql as $$
declare _j uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.' || _cust)::uuid, 100, 'direct');
  update public.jobs set status = _status::job_status, created_at = now() - _created where id = _j;
  perform set_config('t.j_' || _tag, _j::text, true);
  return _j;
end $$;

select pg_temp.job('j0', 'c1', 'completed', interval '30 days');          -- earlier completed delivery (outside the window)
select pg_temp.job('j1', 'c1', 'open');                                    -- becomes: repeat, completed, with an accepted offer
select pg_temp.job('j2', 'c1', 'cancelled');                               -- cancelled: price too high, no offers
select pg_temp.job('j3', 'c1', 'open');                                    -- open, one offer not accepted
select pg_temp.job('j4', 'c2', 'cancelled');                               -- unclassified cancellation (unknown)
select pg_temp.job('j5', 'c2', 'open');                                    -- becomes: invited driver chosen
select pg_temp.job('j6', 'c2', 'cancelled');                               -- system no-show
update public.jobs set cancellation_reason_code = 'price_too_high' where id = current_setting('t.j_j2')::uuid;
update public.jobs set cancellation_reason_code = 'driver_did_not_arrive' where id = current_setting('t.j_j6')::uuid;
do $$
declare b1 uuid; b3 uuid; b5 uuid;
begin
  b1 := tests.create_bid(current_setting('t.j_j1')::uuid, current_setting('t.d1')::uuid, 100);
  b3 := tests.create_bid(current_setting('t.j_j3')::uuid, current_setting('t.d2')::uuid, 100);
  b5 := tests.create_bid(current_setting('t.j_j5')::uuid, current_setting('t.d1')::uuid, 100);
  update public.jobs set accepted_bid_id = b1 where id = current_setting('t.j_j1')::uuid;
  update public.jobs set accepted_bid_id = b5 where id = current_setting('t.j_j5')::uuid;
end $$;
update public.jobs set status = 'completed' where id = current_setting('t.j_j1')::uuid;
update public.jobs set status = 'accepted', preferred_driver_id = current_setting('t.d1')::uuid, driver_id = current_setting('t.d1')::uuid
 where id = current_setting('t.j_j5')::uuid;

-- a real no-show reopening: accept, age, sweep, customer reopens (j8), then completed
select set_config('t.j_j8', tests.create_job(current_setting('t.c1')::uuid, 100, 'direct')::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.d2')::uuid, final_price = 100 where id = current_setting('t.j_j8')::uuid;
alter table public.jobs disable trigger t_jobs_updated;
update public.jobs set updated_at = now() - interval '30 hours' where id = current_setting('t.j_j8')::uuid;
alter table public.jobs enable trigger t_jobs_updated;
select tests.as_service();
select public.expire_stale_accepted_jobs();
select tests.login_as(current_setting('t.c1')::uuid);
select public.customer_reopen_no_show_job(current_setting('t.j_j8')::uuid);
select tests.as_owner();
update public.jobs set status = 'completed', driver_id = current_setting('t.d1')::uuid where id = current_setting('t.j_j8')::uuid;

-- feedback and dispatch offers
insert into public.delivery_feedback (job_id, customer_id, answer) values (current_setting('t.j_j1')::uuid, current_setting('t.c1')::uuid, 'price_worked');
insert into public.job_dispatch_offers (job_id, driver_id, wave, status, offered_at, expires_at, responded_at, viewed_at) values
  (current_setting('t.j_j3')::uuid, current_setting('t.d1')::uuid, 1, 'rejected', now(), now() + interval '1 minute', now(), now()),
  (current_setting('t.j_j2')::uuid, current_setting('t.d1')::uuid, 1, 'expired',  now(), now() + interval '1 minute', null, null),
  (current_setting('t.j_j1')::uuid, current_setting('t.d1')::uuid, 0, 'rejected', now(), now(), now(), null);   -- system exclusion row

-- access
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$select public.admin_marketplace_metrics(7)$$, null, null, 'a customer cannot read the metrics');
select tests.as_anon();
select throws_ok($$select public.admin_marketplace_metrics(7)$$, null, null, 'an anonymous caller cannot read the metrics');
select tests.as_owner();

-- jobs section (jobs are counted as jobs)
select is(pg_temp.m('{jobs,requests_created}') - current_setting('t.b_req')::numeric, 7::numeric, 'requests created counts new jobs (a reopened job is not a new request)');
select is(pg_temp.m('{jobs,with_offer,n}') - current_setting('t.b_offn')::numeric, 3::numeric, 'requests that received at least one offer');
select is(pg_temp.m('{jobs,offer_accepted,n}') - current_setting('t.b_acc')::numeric, 2::numeric, 'offer accepted: jobs with an accepted offer');
select is(pg_temp.m('{jobs,offer_accepted,d}') - current_setting('t.b_offd')::numeric, 3::numeric, 'its denominator is jobs with at least one offer, not all jobs');
select is(pg_temp.m('{jobs,verified_completed,n}') - current_setting('t.b_done')::numeric, 2::numeric, 'completed deliveries in the window');
select is(pg_temp.m('{jobs,cancelled_by_reason,price_too_high}') - current_setting('t.b_price')::numeric, 1::numeric, 'cancellations by structured reason');
select is(pg_temp.m('{jobs,cancelled_by_reason,unknown}') - current_setting('t.b_unk')::numeric, 1::numeric, 'unclassified cancellations are shown as unknown, not guessed');
select is(pg_temp.m('{jobs,no_shows,n}') - current_setting('t.b_noshow')::numeric, 1::numeric, 'system no-shows');
select is(pg_temp.m('{jobs,no_show_reopened,reopened}') - current_setting('t.b_reop')::numeric, 1::numeric, 'no-show reopenings are counted as reopenings');
select is(pg_temp.m('{jobs,no_show_reopened,reopened_then_completed}') - current_setting('t.b_reopd')::numeric, 1::numeric, 'and their later completion separately');
select is(pg_temp.m('{jobs,repeat_requests,n}') - current_setting('t.b_rrq')::numeric, 4::numeric, 'repeat requests: customers with an earlier completed delivery');
select is(pg_temp.m('{jobs,repeat_verified_completed,n}') - current_setting('t.b_rdone')::numeric, 2::numeric, 'repeat completed deliveries are measured separately from repeat requests');
select is(pg_temp.m('{jobs,invited_chosen,n}') - current_setting('t.b_invch')::numeric, 1::numeric, 'invited previous driver chosen');

-- feedback and offers (offers are counted as offers)
select is(pg_temp.m('{feedback,by_answer,price_worked}') - current_setting('t.b_fbp')::numeric, 1::numeric, 'feedback answer distribution');
select is(pg_temp.m('{offers,sent}') - current_setting('t.b_osent')::numeric, 2::numeric, 'offers sent exclude system exclusion rows');
select is((pg_temp.m('{offers,viewed}') - current_setting('t.b_oview')::numeric)::text || '/' || (pg_temp.m('{offers,declined}') - current_setting('t.b_odecl')::numeric)::text || '/' || (pg_temp.m('{offers,expired}') - current_setting('t.b_oexp')::numeric)::text,
  '1/1/1', 'offers viewed, declined and expired');

-- no identifiers in the output; reopening is tracked on the job
select tests.login_as(current_setting('t.admin')::uuid);
select ok(position(current_setting('t.c1') in public.admin_marketplace_metrics(7)::text) = 0
      and position(current_setting('t.d1') in public.admin_marketplace_metrics(7)::text) = 0, 'the aggregate output contains no customer or driver identifiers');
select tests.as_owner();

select * from finish();
rollback;
