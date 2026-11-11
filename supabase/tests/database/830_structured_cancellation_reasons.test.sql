-- 0148: structured cancellation reasons.
--   * the person who cancelled can attach ONE role-appropriate category to their own cancellation
--   * the server decides who the actor is; clients cannot write the column, claim a system no-show,
--     or describe someone else's cancellation
--   * the existing free-text reason is untouched; old cancellations stay NULL (unknown)
--   * the 24 h no-show sweep is classified by the server, and a manual cancel with the sweep's wording is not
--   * reopening a cancelled job clears the code
begin;
select plan(17);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('cr_cust')::text, true);
select set_config('t.other', tests.create_user('cr_other')::text, true);
select set_config('t.admin', tests.create_user('cr_admin', array['admin'])::text, true);
select set_config('t.drv',   tests.create_driver('cr_drv', 100)::text, true);

create or replace function pg_temp.job(_tag text, _accepted boolean default false) returns uuid
language plpgsql as $$
declare _j uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 100, 'direct');
  if _accepted then
    update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 100 where id = _j;
  end if;
  perform set_config('t.j_' || _tag, _j::text, true);
  return _j;
end $$;
create or replace function pg_temp.code(_tag text) returns text language sql as $$
  select cancellation_reason_code from public.jobs where id = current_setting('t.j_' || _tag)::uuid $$;
create or replace function pg_temp.rec(_tag text, _code text) returns void language sql as $$
  select public.record_cancellation_reason(current_setting('t.j_' || _tag)::uuid, _code) $$;

-- 1-4: the customer cancels, then describes it
select pg_temp.job('a');
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j_a')::uuid, 'too expensive for me');
select lives_ok($$select pg_temp.rec('a', 'price_too_high')$$, 'the customer can describe their own cancellation');
select tests.as_owner();
select is(pg_temp.code('a'), 'price_too_high', 'the category is stored');
select is((select cancellation_reason from public.jobs where id = current_setting('t.j_a')::uuid), 'too expensive for me', 'the free-text reason is preserved');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select pg_temp.rec('a', 'other')$$, null, null, 'a reason can only be recorded once');

-- 5-6: invalid and wrong-role categories
select pg_temp.job('b');
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j_b')::uuid, '');
select throws_ok($$select pg_temp.rec('b', 'made_up')$$, null, null, 'an unknown category is refused');
select throws_ok($$select public.record_cancellation_reason(current_setting('t.j_b')::uuid, null)$$, null, null, 'a missing category is refused');

-- 7: someone else cannot describe it
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok($$select pg_temp.rec('b', 'customer_changed_plans')$$, null, null, 'another user cannot describe my cancellation');

-- 8: clients cannot write the column directly
select tests.login_as(current_setting('t.cust')::uuid);
do $$ begin
  update public.jobs set cancellation_reason_code = 'other' where id = current_setting('t.j_b')::uuid;
exception when others then null;
end $$;
select tests.as_owner();
select is(pg_temp.code('b'), null, 'a direct client update of the code has no effect');

-- 9: the driver's own release (job reopens) can be described with a driver-appropriate category only
select pg_temp.job('c', true);
select tests.login_as(current_setting('t.drv')::uuid);
select public.cancel_job(current_setting('t.j_c')::uuid, 'truck problem');
select throws_ok($$select pg_temp.rec('c', 'price_too_high')$$, null, null, 'a driver cannot use a customer-only category');
select lives_ok($$select pg_temp.rec('c', 'material_unavailable')$$, 'a driver can describe their own release');
select tests.as_owner();
select is((select reason_code from public.cancellation_events where job_id = current_setting('t.j_c')::uuid and role = 'driver'),
  'material_unavailable', 'the category lands on the driver''s own cancellation record');

-- 10: the sweep is classified by the server
select pg_temp.job('d', true);
alter table public.jobs disable trigger t_jobs_updated;
update public.jobs set updated_at = now() - interval '30 hours' where id = current_setting('t.j_d')::uuid;
alter table public.jobs enable trigger t_jobs_updated;
select tests.as_service();
select public.expire_stale_accepted_jobs();
select tests.as_owner();
select is(pg_temp.code('d'), 'driver_did_not_arrive', 'a 24 h no-show cancellation is classified by the server');

-- 11: a manual cancel with the sweep's exact wording is NOT classified as a no-show
select pg_temp.job('e', true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j_e')::uuid, 'Driver did not start pickup within 24 hours of accepting');
select tests.as_owner();
select is(pg_temp.code('e'), null, 'a manual cancel cannot pass as a system no-show');

-- 12: reopening clears the code
select tests.login_as(current_setting('t.cust')::uuid);
select public.customer_reopen_no_show_job(current_setting('t.j_d')::uuid);
select tests.as_owner();
select is(pg_temp.code('d'), null, 'reopening a job clears its cancellation category');

-- 13: an admin who cancelled can describe it
select pg_temp.job('f');
select tests.login_as(current_setting('t.admin')::uuid);
select public.cancel_job(current_setting('t.j_f')::uuid, 'Duplicate request from the customer');
select lives_ok($$select pg_temp.rec('f', 'other')$$, 'an admin can describe a cancellation they made');
select tests.as_owner();
select is(pg_temp.code('f'), 'other', 'and it is stored');

-- 14: anonymous callers are refused
select tests.as_anon();
select throws_ok($$select pg_temp.rec('f', 'other')$$, null, null, 'anonymous callers cannot record reasons');
select tests.as_owner();

select * from finish();
rollback;
