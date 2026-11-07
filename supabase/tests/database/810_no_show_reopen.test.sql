-- 0147: after the 24 h no-show sweep cancels a job, the CUSTOMER can choose to reopen it.
--   * only the job's customer, only for a sweep cancellation of a direct-pay job the driver never reached
--   * refused when the driver arrived, loaded, a dispute exists, or the job was cancelled for another reason
--   * the no-show driver is excluded; delivery code, driver and price are cleared; a dispatch wave starts
--   * commission rules untouched: the sweep already released the reserve; reopening holds nothing
begin;
select plan(12);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('nsr_cust')::text, true);
select set_config('t.other', tests.create_user('nsr_other')::text, true);
select set_config('t.drv',   tests.create_driver('nsr_drv', 100)::text, true);

create or replace function pg_temp.swept(_tag text, _pay text default 'direct') returns uuid
language plpgsql as $$
declare _j uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 100, _pay);
  update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 100 where id = _j;
  alter table public.jobs disable trigger t_jobs_updated;
  update public.jobs set updated_at = now() - interval '30 hours' where id = _j;
  alter table public.jobs enable trigger t_jobs_updated;
  perform set_config('t.j_' || _tag, _j::text, true);
  return _j;
end $$;
create or replace function pg_temp.st(_tag text) returns text language sql as $$
  select status::text from public.jobs where id = current_setting('t.j_' || _tag)::uuid $$;

select pg_temp.swept('ok');
select pg_temp.swept('arrived');
select pg_temp.swept('loaded');
select pg_temp.swept('disp');
select pg_temp.swept('manual');
update public.jobs set driver_arrived_pickup_at = now() - interval '2 hours' where id = current_setting('t.j_arrived')::uuid;
select tests.as_service();
select ok(public.expire_stale_accepted_jobs() >= 4, 'the sweep cancels the overdue jobs as before');
select tests.as_owner();

-- a manual cancel by the customer (not a no-show) and a dispute
update public.jobs set pickup_photo_url = 'x' where id = current_setting('t.j_loaded')::uuid;
insert into public.disputes (job_id, raised_by, against, reason) values
  (current_setting('t.j_disp')::uuid, current_setting('t.cust')::uuid, current_setting('t.drv')::uuid, 'driver never came');
update public.jobs set cancellation_reason = 'I changed my mind' where id = current_setting('t.j_manual')::uuid;

select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_ok')), null, null, 'another user cannot reopen it');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_arrived')), null, null, 'refused when the driver had arrived at pickup');
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_loaded')), null, null, 'refused when the load was collected');
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_disp')), null, null, 'refused when a dispute exists');
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_manual')), null, null, 'refused when the job was cancelled for another reason');

select lives_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_ok')), 'the customer can reopen a no-show job');
select tests.as_owner();
select is(pg_temp.st('ok'), 'open', 'the job is open again');
select ok((select driver_id is null and final_price is null and held_commission is null and delivery_pin is null and cancelled_at is null
             from public.jobs where id = current_setting('t.j_ok')::uuid), 'driver, price, reserve, code and cancellation are cleared');
select ok((select expires_at > now() + interval '23 hours' from public.jobs where id = current_setting('t.j_ok')::uuid), 'it stays open for at least 24 hours');
select ok(not exists (select 1 from public.job_dispatch_offers where job_id = current_setting('t.j_ok')::uuid
                        and driver_id = current_setting('t.drv')::uuid and status = 'pending'), 'the no-show driver is not offered it again');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.customer_reopen_no_show_job(%L)$$, current_setting('t.j_ok')), null, null, 'it cannot be reopened twice');
select tests.as_owner();

select * from finish();
rollback;
