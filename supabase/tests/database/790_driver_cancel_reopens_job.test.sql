-- 0145: when the assigned driver cancels an accepted, direct-pay job before pickup, the job reopens
-- for other drivers instead of dying. The driver's strike is still recorded, the commission reserve
-- is released by the EXISTING release_job_commission (no financial logic changes), the next driver
-- gets a fresh reserve, and every other cancellation stage behaves exactly as before.
begin;
select plan(19);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('ro_cust')::text, true);
select set_config('t.d',  tests.create_driver('ro_d', 100)::text, true);    -- cancels
select set_config('t.d2', tests.create_driver('ro_d2', 100)::text, true);   -- earlier bidder, wins after the reopen
select set_config('t.d3', tests.create_driver('ro_d3', 100)::text, true);   -- in progress
select set_config('t.d4', tests.create_driver('ro_d4', 100)::text, true);   -- already loaded
select set_config('t.d5', tests.create_driver('ro_d5', 100)::text, true);   -- escrow job
select set_config('t.d6', tests.create_driver('ro_d6', 100)::text, true);   -- customer cancels

create or replace function pg_temp.held(_u text) returns numeric language sql as $$
  select held from public.wallets where user_id = current_setting(_u)::uuid
$$;
create or replace function pg_temp.assign(_driver text, _status text default 'accepted', _method text default 'direct') returns uuid
language plpgsql as $$
declare _j uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 100, _method);
  update public.jobs set status = _status::public.job_status, driver_id = current_setting(_driver)::uuid, final_price = 100 where id = _j;
  return _j;
end $$;

-- A job with two offers; the customer accepts the first driver's.
select tests.as_owner();
select set_config('t.j', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select set_config('t.bid_d',  tests.create_bid(current_setting('t.j')::uuid, current_setting('t.d')::uuid, 100)::text, true);
select set_config('t.bid_d2', tests.create_bid(current_setting('t.j')::uuid, current_setting('t.d2')::uuid, 110)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_d')), '1: customer accepts the first driver');
select tests.as_owner();
select is(pg_temp.held('t.d'), 7.00::numeric, '2: the 7% commission is reserved for that driver');

-- The driver cancels before pickup.
select tests.login_as(current_setting('t.d')::uuid);
select lives_ok(format($$select public.cancel_job(%L, 'truck broke down')$$, current_setting('t.j')), '3: the assigned driver cancels before pickup');
select tests.as_owner();
select ok((select status::text = 'open' and driver_id is null and accepted_bid_id is null and final_price is null
                  and held_commission is null and expires_at >= now() + interval '23 hours'
             from public.jobs where id = current_setting('t.j')::uuid),
  '4: the job is open again with no driver, price or reserve, and a fresh bidding window');
select ok(pg_temp.held('t.d') = 0 and tests.balance(current_setting('t.d')::uuid) = 100.00::numeric,
  '5: the reserve is released and the driver''s balance is untouched');
select is((select count(*)::int from public.cancellation_events
            where job_id = current_setting('t.j')::uuid and user_id = current_setting('t.d')::uuid
              and role = 'driver' and stage = 'post_acceptance'),
  1, '6: the driver''s cancellation is still recorded against them');
select is((select status::text from public.bids where id = current_setting('t.bid_d')::uuid), 'withdrawn',
  '7: the cancelling driver''s accepted offer is marked withdrawn');
select ok((select status::text = 'pending' and expires_at > now() from public.bids where id = current_setting('t.bid_d2')::uuid),
  '8: the other driver''s earlier offer is back and pending with a fresh clock');
select is((select count(*)::int from public.notifications where job_id = current_setting('t.j')::uuid
            and user_id = current_setting('t.cust')::uuid and type = 'job_reopened'),
  1, '9: the customer is told the request is open again');
select is((select count(*)::int from public.notifications where job_id = current_setting('t.j')::uuid
            and user_id = current_setting('t.d2')::uuid and type = 'offer_reopened'),
  1, '10: the earlier bidder is told their offer is live again');
select is((select count(*)::int from public.job_delivery_pins where job_id = current_setting('t.j')::uuid),
  0, '11: the old delivery code is gone (a new one is made on the next acceptance)');
select is((select status::text from public.job_dispatch_offers where job_id = current_setting('t.j')::uuid and driver_id = current_setting('t.d')::uuid),
  'rejected', '12: the cancelling driver is never offered the job again');

-- The customer chooses again; the cancelling driver can no longer be chosen.
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.bid_d')), '%no longer available%',
  '13: the withdrawn offer cannot be accepted');
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid_d2')), '14: the customer accepts the other driver');
select tests.as_owner();
select ok((select held_commission = 7.70 from public.jobs where id = current_setting('t.j')::uuid)
          and pg_temp.held('t.d2') = 7.70 and pg_temp.held('t.d') = 0,
  '15: the new driver gets their own 7% reserve and nothing is reserved twice');

-- Other stages behave exactly as before.
select set_config('t.j_prog', pg_temp.assign('t.d3', 'in_progress')::text, true);
select tests.login_as(current_setting('t.d3')::uuid);
select throws_like(format($$select public.cancel_job(%L, 'x')$$, current_setting('t.j_prog')), '%dispute%',
  '16: an in-progress job still needs a dispute, not a cancel');

select set_config('t.j_load', pg_temp.assign('t.d4')::text, true);
update public.jobs set pickup_photo_url = current_setting('t.j_load') || '/pickup-x.jpg' where id = current_setting('t.j_load')::uuid;
select tests.login_as(current_setting('t.d4')::uuid);
select public.cancel_job(current_setting('t.j_load')::uuid, 'x');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.j_load')::uuid), 'cancelled',
  '17: once the load has been collected a driver cancel still cancels (no reopen)');

select set_config('t.j_esc', pg_temp.assign('t.d5', 'accepted', 'escrow')::text, true);
select tests.login_as(current_setting('t.d5')::uuid);
select public.cancel_job(current_setting('t.j_esc')::uuid, 'x');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.j_esc')::uuid), 'cancelled',
  '18: an escrow job keeps the existing cancel and refund path (no reopen)');

select set_config('t.j_cust', pg_temp.assign('t.d6')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j_cust')::uuid, 'changed my mind');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.j_cust')::uuid), 'cancelled',
  '19: a customer cancelling an accepted job is unchanged');

select * from finish();
rollback;
