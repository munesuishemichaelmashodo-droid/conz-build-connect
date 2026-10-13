-- 0089 — geographic dispatch: only available, verified, truck-owning drivers
-- near the PICKUP are offered a job; radius expands in controlled stages up to
-- a hard ceiling; acceptance re-validates eligibility server-side.
-- Job site: Marondera (-18.18, 31.55). Distances: near ~8 km, mid ~40 km,
-- far80 ~80 km, Bulawayo ~350 km. Stages: 25 / 50 / 100 km (defaults).

begin;
select plan(40);

select set_config('t.cust',  tests.create_user('geo_cust')::text, true);
select set_config('t.admin', tests.create_user('geo_admin', array['admin'])::text, true);
select set_config('t.near',  tests.create_driver('geo_near', 100)::text, true);
select set_config('t.mid',   tests.create_driver('geo_mid', 100)::text, true);
select set_config('t.far80', tests.create_driver('geo_far80', 100)::text, true);
select set_config('t.bulawayo', tests.create_driver('geo_byo', 100)::text, true);
select set_config('t.notruck', tests.create_driver('geo_notruck', 100)::text, true);
select set_config('t.offline', tests.create_driver('geo_offline', 100)::text, true);
select set_config('t.stale', tests.create_driver('geo_stale', 100)::text, true);
select set_config('t.unver', tests.create_driver('geo_unver', 100)::text, true);
select set_config('t.susp', tests.create_driver('geo_susp', 100)::text, true);
select set_config('t.reverify', tests.create_driver('geo_reverify', 100)::text, true);
select set_config('t.limited', tests.create_driver('geo_limited', 100)::text, true);
select set_config('t.busy', tests.create_driver('geo_busy', 100)::text, true);

select tests.as_owner();

create function pg_temp.place(_drv text, _lat numeric, _lng numeric, _avail boolean default true, _age interval default '0')
returns void language sql as $$
  insert into public.driver_availability (driver_id, lat, lng, is_available, updated_at)
  values (current_setting('t.' || _drv)::uuid, _lat, _lng, _avail, now() - _age)
  on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng,
    is_available = excluded.is_available, updated_at = excluded.updated_at;
$$;
create function pg_temp.new_job(_age interval default '0') returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget,
                           delivery_lat, delivery_lng, pickup_lat, pickup_lng)
  values (current_setting('t.cust')::uuid, 'custom', 12, 'Marondera', 400, -18.18, 31.55, -18.18, 31.55)
  returning id into _id;
  -- discard anything the insert-time dispatch trigger created: tests drive waves explicitly
  delete from public.job_dispatch_offers where job_id = _id;
  delete from public.notifications where job_id = _id;
  update public.jobs set created_at = now() - _age where id = _id;
  return _id;
end $$;
create function pg_temp.elig(_job uuid, _drv text, _radius numeric) returns boolean language sql as $$
  select exists (select 1 from public.eligible_dispatch_drivers(_job, _radius) e where e.driver_id = current_setting('t.' || _drv)::uuid)
$$;

-- positions
select pg_temp.place('near', -18.25, 31.55);
select pg_temp.place('mid', -18.54, 31.55);
select pg_temp.place('far80', -18.90, 31.55);
select pg_temp.place('bulawayo', -20.15, 28.58);
select pg_temp.place('notruck', -18.25, 31.55);
select pg_temp.place('offline', -18.25, 31.55, false);
select pg_temp.place('stale', -18.25, 31.55, true, interval '20 minutes');
select pg_temp.place('unver', -18.25, 31.55);
select pg_temp.place('susp', -18.25, 31.55);
select pg_temp.place('reverify', -18.25, 31.55);
select pg_temp.place('limited', -18.25, 31.55);
select pg_temp.place('busy', -18.25, 31.55);
delete from public.trucks where driver_id = current_setting('t.notruck')::uuid;
update public.driver_profiles set verification_status = 'pending' where user_id = current_setting('t.unver')::uuid;
update public.profiles set status = 'suspended' where id = current_setting('t.susp')::uuid;
update public.driver_profiles set reverify_due_at = now() - interval '1 day' where user_id = current_setting('t.reverify')::uuid;
update public.wallets set limited = true where user_id = current_setting('t.limited')::uuid;
insert into public.jobs (customer_id, driver_id, material, quantity_m3, delivery_address, budget, status)
values (current_setting('t.cust')::uuid, current_setting('t.busy')::uuid, 'custom', 5, 'elsewhere', 100, 'in_progress');

select set_config('t.job', pg_temp.new_job()::text, true);

-- 1-4: radius gates distance
select is((select count(*)::int from public.eligible_dispatch_drivers(current_setting('t.job')::uuid, 25)), 1, '25 km: only the near driver');
select ok(pg_temp.elig(current_setting('t.job')::uuid, 'near', 25), '25 km includes near');
select is((select count(*)::int from public.eligible_dispatch_drivers(current_setting('t.job')::uuid, 50)), 2, '50 km: near + mid');
select is((select count(*)::int from public.eligible_dispatch_drivers(current_setting('t.job')::uuid, 100)), 3, '100 km: near + mid + far80; Bulawayo is never eligible');

-- 5-14: every disqualifier excludes at the widest radius
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'bulawayo', 100), 'Bulawayo driver excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'notruck', 100), 'driver without a truck excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'offline', 100), 'unavailable driver excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'stale', 100), 'driver with a stale position excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'unver', 100), 'unverified driver excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'susp', 100), 'suspended account excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'reverify', 100), 're-verification overdue excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'limited', 100), 'limited wallet excluded');
select ok(not pg_temp.elig(current_setting('t.job')::uuid, 'busy', 100), 'driver on an active job excluded');
select is((select driver_id from public.eligible_dispatch_drivers(current_setting('t.job')::uuid, 100) limit 1),
          current_setting('t.near')::uuid, 'closest driver is ranked first');

-- 15-16: no location / not open
select is((select count(*)::int from public.eligible_dispatch_drivers(
            (select id from public.jobs where delivery_address = 'elsewhere'), 100)), 0, 'non-open job: nobody eligible');
with n as (
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget)
  values (current_setting('t.cust')::uuid, 'custom', 5, 'no pin', 100) returning id)
select set_config('t.noloc', (select id::text from n), true);
select is((select count(*)::int from public.eligible_dispatch_drivers(current_setting('t.noloc')::uuid, 1000)), 0,
          'job with no pickup or delivery location: nobody eligible, no default depot');

-- 17-20: stage maths
select is((select radius_km from public.dispatch_stage_for(now())), 25::numeric, 'stage 1 = 25 km');
select is((select radius_km from public.dispatch_stage_for(now() - interval '4 minutes')), 50::numeric, 'stage 2 = 50 km after 3+ min');
select is((select radius_km from public.dispatch_stage_for(now() - interval '7 minutes')), 100::numeric, 'stage 3 = 100 km');
select is((select final_stage from public.dispatch_stage_for(now() - interval '2 days')), true, 'ceiling stays at the last stage (no unbounded expansion)');

-- 21-22: configuration validated, falls back to safe defaults
insert into public.system_settings (key, value) values ('dispatch_radius_stages_km', '[50, 25]'::jsonb)
  on conflict (key) do update set value = excluded.value;
select is(public.dispatch_stage_radii(), array[25, 50, 100]::numeric[], 'non-increasing stages rejected -> defaults');
update public.system_settings set value = '[10, 20]'::jsonb where key = 'dispatch_radius_stages_km';
select is((select radius_km from public.dispatch_stage_for(now())), 10::numeric, 'valid custom stages are honoured');
update public.system_settings set value = '[25, 50, 100]'::jsonb where key = 'dispatch_radius_stages_km';

-- 23-27: waves honour the stage
select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 1, 'wave 1 (25 km) offers exactly one driver');
select is((select driver_id from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid),
          current_setting('t.near')::uuid, 'the offer went to the near driver');
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 0, 'no repeat offer to the same driver, no early widening');
select tests.as_owner();
update public.jobs set created_at = now() - interval '4 minutes' where id = current_setting('t.job')::uuid;
select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 1, 'after 3 min the 50 km stage adds mid only');
select tests.as_owner();
update public.jobs set created_at = now() - interval '7 minutes' where id = current_setting('t.job')::uuid;
select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 1, 'after 6 min the 100 km stage adds far80 only');

-- 28-29: ceiling reached -> one escalation to admins, never a nationwide broadcast
select tests.as_owner();
update public.job_dispatch_offers set status = 'expired' where job_id = current_setting('t.job')::uuid;
select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.job')::uuid, 5), 0, 'ceiling: nobody new is offered');
select is((select count(*)::int from public.job_dispatch_offers where job_id = current_setting('t.job')::uuid
            and driver_id = current_setting('t.bulawayo')::uuid), 0, 'Bulawayo driver never received an offer');
select tests.as_owner();
select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid
            and type = 'dispatch_manual_needed' and user_id = current_setting('t.admin')::uuid), 1, 'admin told once to dispatch manually');
select tests.as_service();
select public.create_dispatch_wave(current_setting('t.job')::uuid, 5);
select tests.as_owner();
select is((select count(*)::int from public.notifications where job_id = current_setting('t.job')::uuid
            and type = 'dispatch_manual_needed' and user_id = current_setting('t.admin')::uuid), 1, 'escalation is idempotent');

-- 31: clients cannot trigger waves
select tests.login_as(current_setting('t.near')::uuid);
select throws_ok(format('select public.create_dispatch_wave(%L, 5)', current_setting('t.job')), '42501', null, 'authenticated cannot call create_dispatch_wave');
select tests.as_owner();

-- 32-36: acceptance is re-validated (job B in the 50 km stage, two eligible drivers)
select set_config('t.jobB', pg_temp.new_job(interval '4 minutes')::text, true);
select tests.as_service();
select is(public.create_dispatch_wave(current_setting('t.jobB')::uuid, 5), 2, 'job B offered to near and mid');
select tests.as_owner();
select set_config('t.offNear', (select id::text from public.job_dispatch_offers where job_id = current_setting('t.jobB')::uuid and driver_id = current_setting('t.near')::uuid), true);
select set_config('t.offMid', (select id::text from public.job_dispatch_offers where job_id = current_setting('t.jobB')::uuid and driver_id = current_setting('t.mid')::uuid), true);

-- an out-of-area driver holding a (hand-inserted) offer cannot accept
select set_config('t.jobC', pg_temp.new_job()::text, true);
insert into public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
values (current_setting('t.jobC')::uuid, current_setting('t.bulawayo')::uuid, 1, now() + interval '5 minutes');
select tests.login_as(current_setting('t.bulawayo')::uuid);
select throws_ok(format('select public.accept_dispatch_offer(%L)',
  (select id from public.job_dispatch_offers where job_id = current_setting('t.jobC')::uuid)), '42501', null, 'out-of-area driver cannot accept');
select tests.as_owner();
select is((select status from public.jobs where id = current_setting('t.jobC')::uuid), 'open', 'job C is still open');
-- a driver without a truck cannot accept even when offered
insert into public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
values (current_setting('t.jobC')::uuid, current_setting('t.notruck')::uuid, 2, now() + interval '5 minutes');
select tests.login_as(current_setting('t.notruck')::uuid);
select throws_ok(format('select public.accept_dispatch_offer(%L)',
  (select id from public.job_dispatch_offers where job_id = current_setting('t.jobC')::uuid and driver_id = current_setting('t.notruck')::uuid)),
  '42501', null, 'driver without a truck cannot accept');
select tests.as_owner();

-- near driver accepts job B; the second eligible driver then loses the race
select tests.login_as(current_setting('t.near')::uuid);
select is(public.accept_dispatch_offer(current_setting('t.offNear')::uuid), current_setting('t.jobB')::uuid, 'eligible driver accepts');
select tests.as_owner();
select is((select driver_id from public.jobs where id = current_setting('t.jobB')::uuid), current_setting('t.near')::uuid, 'job assigned to the near driver');
select tests.login_as(current_setting('t.mid')::uuid);
select throws_ok(format('select public.accept_dispatch_offer(%L)', current_setting('t.offMid')), null, 'Offer no longer available', 'second driver cannot take an assigned job');
select tests.as_owner();
select is((select status::text from public.job_dispatch_offers where id = current_setting('t.offMid')::uuid), 'superseded', 'losing offer is superseded');

select * from finish();
rollback;
