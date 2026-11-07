-- 0146: dispatch offers reach drivers outside the open app.
--   * live drivers (location refreshed < 2 min) get a 60 s window, reachable-but-not-live drivers 5 min
--   * every offered driver gets one dispatch_offer notification (so push fires), without the street address
--   * a repeat wave never duplicates offers or notifications
--   * expiry no longer records a "response"; decline still does
--   * a driver can mark their own offer viewed (idempotent); nobody else can
--   * admin_dispatch_summary counts offers honestly and is admin-only
begin;
select plan(15);

select set_config('t.cust',  tests.create_user('dpw_cust')::text, true);
select set_config('t.admin', tests.create_user('dpw_admin', array['admin'])::text, true);
select set_config('t.live',  tests.create_driver('dpw_live', 100)::text, true);
select set_config('t.warm',  tests.create_driver('dpw_warm', 100)::text, true);
select set_config('t.cold',  tests.create_driver('dpw_cold', 100)::text, true);
select tests.as_owner();

create function pg_temp.place(_drv text, _age interval) returns void language sql as $$
  insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at)
  values (current_setting('t.' || _drv)::uuid, -18.25, 31.55, true, now() - _age)
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng,
    is_available = true, updated_at = excluded.updated_at;
$$;
select pg_temp.place('live', interval '30 seconds');
select pg_temp.place('warm', interval '10 minutes');
select pg_temp.place('cold', interval '40 minutes');

insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, delivery_lat, delivery_lng, pickup_lat, pickup_lng)
values (current_setting('t.cust')::uuid, 'custom', 12, '12 Secret Street Marondera', 400, -18.18, 31.55, -18.18, 31.55);
select set_config('t.job', (select id::text from public.jobs where delivery_address like '12 Secret%'), true);
delete from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid;
delete from public.notifications where job_id = current_setting('t.job')::uuid;

select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 2, 'live and reachable drivers are offered; the 40-minute-old one is not');
select tests.as_owner();

create function pg_temp.win(_d text) returns interval language sql as $$
  select expires_at - offered_at from public.job_dispatch_offers
   where job_id = current_setting('t.job')::uuid and driver_id = current_setting('t.' || _d)::uuid
$$;
select is(pg_temp.win('live'), interval '60 seconds', 'a live driver gets a 60 second window');
select is(pg_temp.win('warm'), interval '5 minutes', 'a driver reachable by push gets a 5 minute window');
select is(pg_temp.win('cold'), null, 'a driver with a stale location gets no offer');

select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid and type = 'dispatch_offer'),
  2, 'one dispatch_offer notification per offered driver');
select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid and type = 'dispatch_offer'
            and (coalesce(body,'') || title) ilike '%Secret Street%'), 0, 'the notification does not reveal the street address');

select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 0, 'a repeat wave offers nobody twice');
select tests.as_owner();
select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid and type = 'dispatch_offer'),
  2, 'and sends no duplicate notifications');

-- viewed
select set_config('t.o_live', (select id::text from public.job_dispatch_offers where driver_id = current_setting('t.live')::uuid), true);
select tests.login_as(current_setting('t.warm')::uuid);
select throws_ok(format('select public.mark_dispatch_offer_viewed(%L)', current_setting('t.o_live')),
  null, null, 'another driver cannot mark someone else''s offer viewed');
select tests.login_as(current_setting('t.live')::uuid);
select lives_ok(format('select public.mark_dispatch_offer_viewed(%L)', current_setting('t.o_live')), 'the offered driver can mark it viewed');
select tests.as_owner();
select ok((select viewed_at is not null from public.job_dispatch_offers where id = current_setting('t.o_live')::uuid), 'viewed_at is recorded');

-- expiry vs decline
update public.job_dispatch_offers set expires_at = now() - interval '1 second' where driver_id = current_setting('t.warm')::uuid and job_id = current_setting('t.job')::uuid;
select tests.as_service();
select public.expire_stale_dispatch_offers(current_setting('t.job')::uuid);
select tests.as_owner();
select is((select status::text from public.job_dispatch_offers where driver_id = current_setting('t.warm')::uuid and job_id = current_setting('t.job')::uuid), 'expired', 'an unanswered offer expires');
select ok((select responded_at is null from public.job_dispatch_offers where driver_id = current_setting('t.warm')::uuid and job_id = current_setting('t.job')::uuid), 'expiry is not counted as a driver response');

-- admin summary
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select (public.admin_dispatch_summary(7)->>'offers')::int >= 2), 'admin summary counts offers');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok('select public.admin_dispatch_summary(7)', null, null, 'customers cannot read the dispatch summary');
select tests.as_owner();

select * from finish();
rollback;
