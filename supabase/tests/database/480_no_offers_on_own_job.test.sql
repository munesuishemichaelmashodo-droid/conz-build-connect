-- 0117 — an account that is both customer and driver can't offer on, or accept, its own job.
begin;
select plan(7);
select tests.enable_launch_features();

select set_config('t.dual', tests.create_driver('own_dual', 100)::text, true);
insert into public.user_roles (user_id, role) values (current_setting('t.dual')::uuid, 'customer') on conflict do nothing;
select set_config('t.cust', tests.create_user('own_cust')::text, true);
select set_config('t.drv',  tests.create_driver('own_drv', 100)::text, true);
select set_config('t.own',  tests.create_job(current_setting('t.dual')::uuid, 400)::text, true);
select set_config('t.other', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);

-- 1. Offering on your own job is refused, through the API as well as by the owner path.
select tests.login_as(current_setting('t.dual')::uuid);
select throws_like(
  format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 380, %L)$$,
         current_setting('t.own'), current_setting('t.dual'), tests.truck_of(current_setting('t.dual')::uuid)),
  '%own job%', 'A driver cannot send an offer on their own job');
select tests.as_owner();
select is((select count(*)::int from public.bids where job_id = current_setting('t.own')::uuid), 0, 'No offer was saved');

-- 2. The same account can still offer on someone else's job, and another driver on theirs.
select lives_ok(format($$select tests.create_bid(%L, %L, 380)$$, current_setting('t.other'), current_setting('t.dual')),
  'A dual-role account can still offer on another customer''s job');
select lives_ok(format($$select tests.create_bid(%L, %L, 390)$$, current_setting('t.own'), current_setting('t.drv')),
  'Another driver can offer on the dual-role account''s job');

-- 3. An offer that got in before the guard can't be accepted by its own driver-customer.
alter table public.bids disable trigger trg_guard_bid_insert;
select set_config('t.selfbid', tests.create_bid(current_setting('t.own')::uuid, current_setting('t.dual')::uuid, 370)::text, true);
alter table public.bids enable trigger trg_guard_bid_insert;
select tests.login_as(current_setting('t.dual')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.selfbid')),
  '%own offer%', 'A customer cannot accept their own offer');
select tests.as_owner();
select is((select driver_id from public.jobs where id = current_setting('t.own')::uuid), null, 'The job stays unassigned');

-- 4. Accepting another driver's offer still works.
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
values (current_setting('t.drv')::uuid, 'topup', 100, 100, 'opening')
on conflict do nothing;
select tests.login_as(current_setting('t.dual')::uuid);
select lives_ok(format($$select public.accept_bid((select id from public.bids where job_id = %L and driver_id = %L))$$,
  current_setting('t.own'), current_setting('t.drv')), 'The customer can accept another driver''s offer');

select * from finish();
rollback;
