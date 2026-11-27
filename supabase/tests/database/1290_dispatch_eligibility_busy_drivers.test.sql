-- 0195: invitations, the broadcast, next loads and every offer write follow the same driver rules:
-- truck type, Commission Credit cover, busy drivers (owner option 1: browse, no offers, other offers withdrawn on
-- assignment). Invitations stay non-exclusive; one job still goes to one driver. Admin explanation is admin-only.
begin;
select plan(35);
select tests.enable_launch_features();
update public.system_settings set value = '7'::jsonb where key = 'commission_rate';

select set_config('t.cust',  tests.create_user('de_cust')::text, true);
select set_config('t.cust2', tests.create_user('de_cust2')::text, true);
select set_config('t.admin', tests.create_user('de_admin', array['admin'])::text, true);
select set_config('t.tip',   tests.create_driver('de_tipper', 100)::text, true);   -- tipper, $100 credit
select set_config('t.flat',  tests.create_driver('de_flatbed', 100)::text, true);  -- flatbed, $100 credit
select set_config('t.unk',   tests.create_driver('de_unknown', 100)::text, true);  -- truck type not recorded
select set_config('t.poor',  tests.create_driver('de_poor', 1)::text, true);       -- flatbed, $1 credit
update public.trucks set body_type = 'tipper'  where driver_id = current_setting('t.tip')::uuid;
update public.trucks set body_type = 'flatbed' where driver_id in (current_setting('t.flat')::uuid, current_setting('t.poor')::uuid);
update public.wallets set promo_balance = 0 where user_id in (current_setting('t.tip')::uuid, current_setting('t.flat')::uuid,
                                                                current_setting('t.unk')::uuid, current_setting('t.poor')::uuid);
-- all four online near Harare (about 3 km from the pickup)
insert into public.driver_availability (driver_id, is_available, lat, lng, updated_at)
select d, true, -17.80, 31.03, now()
  from unnest(array[current_setting('t.tip'), current_setting('t.flat'), current_setting('t.unk'), current_setting('t.poor')]::uuid[]) d
on conflict (driver_id) do update set is_available = true, lat = excluded.lat, lng = excluded.lng, updated_at = now();

create or replace function pg_temp.job(_cust text, _budget numeric, _truck text default 'any', _desc text default null) returns uuid
language plpgsql as $$
declare _id uuid;
begin
  perform tests.as_owner();
  insert into public.jobs (customer_id, material, custom_material, quantity_m3, delivery_address, delivery_lat, delivery_lng,
                           pickup_address, pickup_lat, pickup_lng, budget, payment_method, truck_requirement)
  values (current_setting(_cust)::uuid, 'custom', _desc, 10, 'Borrowdale, Harare', -17.75, 31.08, 'Msasa, Harare', -17.82, 31.05,
          _budget, 'direct', _truck)
  returning id into _id;
  return _id;
end $$;
create or replace function pg_temp.reasons(_job uuid, _drv text) returns text[] language sql as $$
  select reasons from public._dispatch_driver_checks(_job) where driver_id = current_setting(_drv)::uuid $$;
create or replace function pg_temp.bid(_job uuid, _drv text, _price numeric) returns uuid language plpgsql as $$
declare _id uuid;
begin
  perform tests.login_as(current_setting(_drv)::uuid);
  insert into public.bids (job_id, driver_id, price, truck_id)
  values (_job, current_setting(_drv)::uuid, _price, tests.truck_of(current_setting(_drv)::uuid)) returning id into _id;
  return _id;
end $$;

-- ============================================================ A. truck type and credit decide invitations
select set_config('t.jf', pg_temp.job('t.cust', 200, 'flatbed', 'Roof sheets, call 0771234567')::text, true);
select is(pg_temp.reasons(current_setting('t.jf')::uuid, 't.tip'), array['truck_type_mismatch'], 'A1: a tipper does not qualify for a flatbed job');
select is(pg_temp.reasons(current_setting('t.jf')::uuid, 't.flat'), array[]::text[], 'A2: a flatbed qualifies');
select is(pg_temp.reasons(current_setting('t.jf')::uuid, 't.unk'), array[]::text[], 'A3: a truck with no recorded type is not excluded');
select is(pg_temp.reasons(current_setting('t.jf')::uuid, 't.poor'), array['insufficient_commission_credit'],
          'A4: $1 credit cannot cover 7% of $200');
select is((select array_agg(driver_id order by driver_id) from public.job_dispatch_offers where job_id = current_setting('t.jf')::uuid),
          (select array_agg(x order by x) from unnest(array[current_setting('t.flat'), current_setting('t.unk')]::uuid[]) x),
          'A5: only the qualifying drivers were invited when the job was posted');
select ok((select bool_and(body like '10 m³ Roof sheets%' and body not like '%0771234567%') from public.notifications
            where job_id = current_setting('t.jf')::uuid and type = 'dispatch_offer'),
          'A6: the invitation names the load by its description, without the phone number');
select is((select count(*)::int from public.notifications where job_id = current_setting('t.jf')::uuid and type = 'new_job'
            and user_id = current_setting('t.poor')::uuid), 0, 'A7: the broadcast is not sent to a driver who cannot cover the commission');

-- ============================================================ B. offers the driver's credit cannot cover are refused
select throws_like($$select pg_temp.bid(current_setting('t.jf')::uuid, 't.poor', 200)$$, 'COMMISSION_CREDIT%',
                   'B1: a driver cannot send an offer their credit does not cover');
select lives_ok($$select set_config('t.bp', pg_temp.bid(current_setting('t.jf')::uuid, 't.poor', 14)::text, true)$$,
                'B2: an offer whose 7% they can cover is accepted ($14 -> $0.98)');
select throws_like($$update public.bids set price = 200 where id = current_setting('t.bp')::uuid$$, 'COMMISSION_CREDIT%',
                   'B3: raising it beyond their credit is refused');
-- a customer counter they could not cover cannot be accepted by the driver
select tests.login_as(current_setting('t.cust')::uuid);
select public.counter_bid(current_setting('t.bp')::uuid, 150);
select tests.login_as(current_setting('t.poor')::uuid);
select throws_matching($$select public.accept_counter(current_setting('t.bp')::uuid)$$, 'COMMISSION_CREDIT|Insufficient wallet balance',
                   'B4: nor accept a counter-offer they cannot cover');

-- ============================================================ C. invitations stay non-exclusive
select tests.as_owner();
select set_config('t.of', (select id::text from public.job_dispatch_offers where job_id = current_setting('t.jf')::uuid
                            and driver_id = current_setting('t.flat')::uuid), true);
select tests.login_as(current_setting('t.flat')::uuid);
select lives_ok($$select public.accept_dispatch_offer(current_setting('t.of')::uuid)$$, 'C1: an invited driver responds');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.jf')::uuid), 'open', 'C2: the job is still open: the customer chooses');
select lives_ok($$select pg_temp.bid(current_setting('t.jf')::uuid, 't.unk', 210)$$, 'C3: another driver can still send an offer');

-- ============================================================ D. busy drivers (option 1)
-- the flatbed driver also has offers elsewhere, then is assigned the flatbed job
select set_config('t.j2', pg_temp.job('t.cust2', 120)::text, true);
select set_config('t.b2', pg_temp.bid(current_setting('t.j2')::uuid, 't.flat', 120)::text, true);
select set_config('t.j3', pg_temp.job('t.cust2', 90)::text, true);  -- invites the flatbed driver too
select tests.as_owner();
select ok(exists (select 1 from public.job_dispatch_offers where job_id = current_setting('t.j3')::uuid
                   and driver_id = current_setting('t.flat')::uuid and status = 'pending'), 'D0: (setup) invited to a third job');
select set_config('t.bf', (select id::text from public.bids where job_id = current_setting('t.jf')::uuid
                            and driver_id = current_setting('t.flat')::uuid), true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select public.accept_bid(current_setting('t.bf')::uuid)$$, 'D1: the customer chooses the flatbed driver');
select tests.as_owner();
select is((select status from public.bids where id = current_setting('t.b2')::uuid), 'withdrawn', 'D2: their offer on another job is withdrawn');
select is((select status from public.job_dispatch_offers where job_id = current_setting('t.j3')::uuid
            and driver_id = current_setting('t.flat')::uuid), 'superseded', 'D3: their pending invitation elsewhere is closed');
select is((select count(*)::int from public.bids where job_id = current_setting('t.jf')::uuid and status = 'accepted'), 1,
          'D4: one accepted offer on the job');
select is((select status from public.bids where job_id = current_setting('t.jf')::uuid and driver_id = current_setting('t.unk')::uuid),
          'rejected', 'D5: the other driver''s offer on it is closed');
select tests.login_as(current_setting('t.flat')::uuid);
select ok((select count(*) from public.driver_open_jobs(50, 0)) >= 1, 'D6: a busy driver can still browse the feed');
select throws_like($$select pg_temp.bid(current_setting('t.j3')::uuid, 't.flat', 90)$$, 'DRIVER_BUSY%', 'D7: but cannot send an offer');
select throws_like($$update public.bids set status = 'pending' where id = current_setting('t.b2')::uuid$$, 'DRIVER_BUSY%',
                   'D8: nor revive a withdrawn offer');
select tests.as_owner();
select ok('busy' = any(pg_temp.reasons(current_setting('t.j3')::uuid, 't.flat')), 'D9: is not eligible for invitations');
select set_config('t.j4', pg_temp.job('t.cust2', 80)::text, true);
select is((select count(*)::int from public.notifications where job_id = current_setting('t.j4')::uuid and type in ('new_job', 'dispatch_offer')
            and user_id = current_setting('t.flat')::uuid), 0, 'D10: and gets neither the broadcast nor an invitation for new jobs');
-- after completion the driver is free again
select tests.deliver(current_setting('t.jf')::uuid);
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.jf')::uuid)) ->> 'ok', 'true', 'D11: the job is completed');
select lives_ok($$select pg_temp.bid(current_setting('t.j3')::uuid, 't.flat', 90)$$, 'D12: the driver can send offers again');
select tests.as_owner();
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.jf')::uuid and type = 'commission'), 1,
          'D13: the commission was charged once');

-- ============================================================ E. admin explanation
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select bool_or(reasons @> array['truck_type_mismatch'] and driver_id = current_setting('t.tip')::uuid)
             from public.admin_dispatch_eligibility(current_setting('t.j3')::uuid)) is false,
          'E1: (any-truck job) a tipper is not excluded for truck type');
select ok((select count(*) from public.admin_dispatch_eligibility(current_setting('t.j3')::uuid)) >= 4, 'E2: an admin sees every driver');
select ok((select bool_and(invitation_status is not null) from public.admin_dispatch_eligibility(current_setting('t.j3')::uuid)
            where eligible_now), 'E3: with their invitation status');
select tests.login_as(current_setting('t.flat')::uuid);
select throws_ok($$select * from public.admin_dispatch_eligibility(current_setting('t.j3')::uuid)$$, '42501', null, 'E4: a driver cannot');
select throws_ok($$select public.driver_commission_covered(auth.uid(), current_setting('t.j3')::uuid, 1)$$, '42501', null,
                 'E5: the internal helpers are not callable by clients');

-- ============================================================ F. next loads respect truck type
select tests.as_owner();
select set_config('t.jt', pg_temp.job('t.cust', 100)::text, true);
select set_config('t.bt', tests.create_bid(current_setting('t.jt')::uuid, current_setting('t.tip')::uuid, 100)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bt')::uuid);
select tests.as_owner();
update public.jobs set status = 'in_progress' where id = current_setting('t.jt')::uuid;
select set_config('t.jnf', pg_temp.job('t.cust2', 100, 'flatbed')::text, true);
select set_config('t.jna', pg_temp.job('t.cust2', 100, 'any')::text, true);
select tests.login_as(current_setting('t.tip')::uuid);
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.tip')::uuid, current_setting('t.jt')::uuid)
            where job_id = current_setting('t.jnf')::uuid), 0, 'F1: a flatbed-only load is not suggested to a tipper');
select is((select count(*)::int from public.find_next_loads_for_driver(current_setting('t.tip')::uuid, current_setting('t.jt')::uuid)
            where job_id = current_setting('t.jna')::uuid), 1, 'F2: an any-truck load is suggested');

select * from finish();
rollback;
