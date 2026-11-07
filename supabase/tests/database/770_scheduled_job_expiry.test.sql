-- 0143: bookings for a later date are not cancelled early.
--   * a client-inserted job stays open until the end of its preferred date (Harare), at least 48 h
--   * the client cannot choose its own expires_at; server-side inserts keep theirs
--   * the 24 h "driver did not start pickup" sweep waits until the preferred date has passed,
--     and does not strike the driver for a trip that was not yet due
--   * existing behaviour is unchanged: an undated stale accepted job is still swept
begin;
select plan(13);
-- These fixtures reuse one driver for several active jobs on purpose: they test other things (evidence,
-- pickup checks, settlement). The one-active-job rule (0144) has its own test, 780, so it is switched off
-- here, inside this rolled-back transaction only.
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('sched_cust')::text, true);
select set_config('t.drv',  tests.create_driver('sched_drv', 100)::text, true);

create or replace function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Africa/Harare')::date
$$;

-- A job inserted the way the app does it (as the signed-in customer).
create or replace function pg_temp.client_job(_date date, _expires timestamptz default null) returns uuid
language plpgsql as $$
declare _id uuid;
begin
  perform tests.login_as(current_setting('t.cust')::uuid);
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method, preferred_date, expires_at)
  values (current_setting('t.cust')::uuid, 'custom', 12, 'Sched address', 100, 'direct', _date, coalesce(_expires, now() + interval '48 hours'))
  returning id into _id;
  perform tests.as_owner();
  return _id;
end $$;

create or replace function pg_temp.expiry(_j uuid) returns timestamptz language sql as $$
  select expires_at from public.jobs where id = _j
$$;

-- ---------------------------------------------------------------------------
-- Insert trigger
-- ---------------------------------------------------------------------------
select set_config('t.j_future', pg_temp.client_job(pg_temp.today() + 5)::text, true);
select is(pg_temp.expiry(current_setting('t.j_future')::uuid),
  ((pg_temp.today() + 6)::timestamp at time zone 'Africa/Harare'),
  'a job for a date 5 days away stays open until the end of that day (Harare)');

select set_config('t.j_undated', pg_temp.client_job(null)::text, true);
select is(pg_temp.expiry(current_setting('t.j_undated')::uuid), now() + interval '48 hours',
  'a job with no date keeps the normal 48 hours');

select set_config('t.j_past', pg_temp.client_job(pg_temp.today() - 3)::text, true);
select is(pg_temp.expiry(current_setting('t.j_past')::uuid), now() + interval '48 hours',
  'a date in the past does not shorten or lengthen the window: 48 hours');

select set_config('t.j_tomorrow', pg_temp.client_job(pg_temp.today() + 1)::text, true);
select is(pg_temp.expiry(current_setting('t.j_tomorrow')::uuid),
  greatest(now() + interval '48 hours', ((pg_temp.today() + 2)::timestamp at time zone 'Africa/Harare')),
  'a job for tomorrow is open at least until the end of tomorrow');

select set_config('t.j_far', pg_temp.client_job(pg_temp.today() + 400)::text, true);
select is(pg_temp.expiry(current_setting('t.j_far')::uuid),
  ((pg_temp.today() + 31)::timestamp at time zone 'Africa/Harare'),
  'a far-future date counts for at most 30 days');

select set_config('t.j_own', pg_temp.client_job(null, '2099-01-01'::timestamptz)::text, true);
select is(pg_temp.expiry(current_setting('t.j_own')::uuid), now() + interval '48 hours',
  'a client cannot choose its own expiry');

select tests.as_owner();
with ins as (
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method, expires_at)
  values (current_setting('t.cust')::uuid, 'custom', 12, 'Server address', 100, 'direct', '2030-01-01'::timestamptz)
  returning id
)
select set_config('t.j_srv', (select id::text from ins), true);
select is(pg_temp.expiry(current_setting('t.j_srv')::uuid), '2030-01-01'::timestamptz,
  'a server-side insert keeps the expiry it sets');

-- ---------------------------------------------------------------------------
-- The accepted-job sweep (24 h without a pickup photo)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.accepted_job(_date date, _hours_old integer) returns uuid
language plpgsql as $$
declare _j uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 100, 'direct');
  update public.jobs
     set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 100, preferred_date = _date
   where id = _j;
  alter table public.jobs disable trigger t_jobs_updated;
  update public.jobs set updated_at = now() - make_interval(hours => _hours_old) where id = _j;
  alter table public.jobs enable trigger t_jobs_updated;
  return _j;
end $$;

create or replace function pg_temp.jstatus(_j uuid) returns text language sql as $$
  select status::text from public.jobs where id = _j
$$;

select set_config('t.a_tomorrow', pg_temp.accepted_job(pg_temp.today() + 1, 30)::text, true);
select set_config('t.a_today',    pg_temp.accepted_job(pg_temp.today(),     30)::text, true);
select set_config('t.a_yesterday',pg_temp.accepted_job(pg_temp.today() - 1, 30)::text, true);
select set_config('t.a_undated',  pg_temp.accepted_job(null,                30)::text, true);
select set_config('t.a_fresh',    pg_temp.accepted_job(null,                 2)::text, true);

select tests.as_service();
select ok(public.expire_stale_accepted_jobs() >= 2, 'the sweep runs and cancels the genuinely overdue jobs');
select tests.as_owner();

select is(pg_temp.jstatus(current_setting('t.a_tomorrow')::uuid), 'accepted',
  'a job accepted for TOMORROW is not cancelled after 24 hours');
select is(pg_temp.jstatus(current_setting('t.a_today')::uuid), 'accepted',
  'a job accepted for TODAY is not cancelled before the day has passed');
select is(pg_temp.jstatus(current_setting('t.a_yesterday')::uuid), 'cancelled',
  'a job whose date has passed with no pickup is cancelled');
select is(pg_temp.jstatus(current_setting('t.a_undated')::uuid), 'cancelled',
  'unchanged: an undated job with no pickup after 24 hours is still cancelled');
select is((select count(*)::int from public.cancellation_events
            where job_id in (current_setting('t.a_tomorrow')::uuid, current_setting('t.a_today')::uuid, current_setting('t.a_fresh')::uuid)),
  0, 'the driver is not struck for a trip that was not yet due (or only just accepted)');

select * from finish();
rollback;
