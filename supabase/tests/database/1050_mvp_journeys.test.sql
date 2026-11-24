-- MVP journeys end to end, through the same RPCs and table writes the app uses, as each real role.
-- Customer: post -> offers -> select -> track -> confirm with code / dispute.  Driver: verification -> offer ->
-- pickup evidence -> trip -> delivery -> commission.  Admin: step-up, verification, disputes, reconciliation.
-- Failure cases: unverified driver, invalid amount, double accept, someone else's job, wrong code, repeat completion,
-- cancellation release, deletion while active. (Provider-paid money is covered by 1020.)
begin;
select plan(32);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('j_cust')::text, true);
select set_config('t.cust2', tests.create_user('j_cust2')::text, true);
select set_config('t.sa',    tests.create_user('j_super', array['super_admin'])::text, true);
select set_config('t.admin', tests.create_user('j_admin', array['admin'])::text, true);
-- A new driver: signed up, profile and truck submitted, NOT verified yet, $50 commission credit.
select set_config('t.drv',  tests.create_user('j_driver', array['driver'])::text, true);
insert into public.driver_profiles (user_id, verification_status, first_job_free_used) values (current_setting('t.drv')::uuid, 'pending', true)
  on conflict (user_id) do update set verification_status = 'pending', first_job_free_used = true;
insert into public.trucks (driver_id, registration, capacity_m3) values (current_setting('t.drv')::uuid, 'JRN-001', 15);
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
  values (current_setting('t.drv')::uuid, 'topup', 50, 50, 'journey test opening credit');
update public.wallets set balance = 50 where user_id = current_setting('t.drv')::uuid;

-- ---------------------------------------------------------------- admin: verification needs a step-up
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like($$select public.admin_set_driver_verification(current_setting('t.drv')::uuid, 'verified', 'docs ok')$$, '%Forbidden%',
                   'A1: a customer cannot verify a driver');

-- ---------------------------------------------------------------- customer posts a job
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 300, 'direct')::text, true);
select is((select status::text from public.jobs where id = current_setting('t.job')::uuid), 'open', 'C1: the customer''s job is open');

-- ---------------------------------------------------------------- an unverified driver cannot offer
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 300, %L)$$,
                        current_setting('t.job'), current_setting('t.drv'), tests.truck_of(current_setting('t.drv')::uuid)),
                 '42501', null, 'D1: an unverified driver''s offer is refused');

select tests.login_as_mfa(current_setting('t.sa')::uuid);
select lives_ok($$select public.admin_set_driver_verification(current_setting('t.drv')::uuid, 'verified', 'ID, licence and truck checked')$$,
                'A2: a super admin with a fresh step-up verifies the driver');
select tests.as_owner();
select ok(public.is_verified_driver(current_setting('t.drv')::uuid), 'A3: the driver is now verified');
select ok(exists (select 1 from public.admin_audit_log where target_user_id = current_setting('t.drv')::uuid), 'A4: the verification is audited');

-- ---------------------------------------------------------------- driver offers (the app's upsert, as the driver)
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 0, %L)$$,
                        current_setting('t.job'), current_setting('t.drv'), tests.truck_of(current_setting('t.drv')::uuid)),
                 '23514', null, 'D2: a $0 offer is refused');
select lives_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, %L, 300, %L)$$,
                       current_setting('t.job'), current_setting('t.drv'), tests.truck_of(current_setting('t.drv')::uuid)),
                'D3: the verified driver makes an offer');
select tests.as_owner();
select set_config('t.bid', (select id::text from public.bids where job_id = current_setting('t.job')::uuid), true);

-- ---------------------------------------------------------------- customer selects the driver
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_like($$select public.accept_bid(current_setting('t.bid')::uuid)$$, '%Not your job%', 'C2: another customer cannot accept the offer');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$select public.accept_bid(current_setting('t.bid')::uuid)$$, 'C3: the customer accepts the offer');
select throws_like($$select public.accept_bid(current_setting('t.bid')::uuid)$$, '%not open%', 'C4: a second accept (double tap) is refused');
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 21.00::numeric, 'M1: 7% of $300 is reserved');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 21.00::numeric, 'M2: the reserve shows as held');
select ok('active_jobs' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)), 'D4: the driver cannot delete the account mid-job');

-- ---------------------------------------------------------------- pickup evidence, trip, tracking
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like($$select public.start_trip(current_setting('t.job')::uuid)$$, '%pickup photo%', 'D5: the trip cannot start without a pickup photo');
-- The app uploads the photo to storage first (job-proof-photos/<job>/...), then records it.
select tests.as_owner();
insert into storage.objects (bucket_id, name) values ('job-proof-photos', current_setting('t.job') || '/pickup.jpg');
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok($$select public.record_job_evidence(current_setting('t.job')::uuid, 'pickup', current_setting('t.job') || '/pickup.jpg', 1000, 'image/jpeg', -17.80, 31.04, 10, 'captured')$$,
                'D6: the driver records the pickup photo with location');
select is((public.start_trip(current_setting('t.job')::uuid)).status::text, 'in_progress', 'D7: the trip starts');
select is((public.start_trip(current_setting('t.job')::uuid)).status::text, 'in_progress', 'D8: starting again is harmless');
select tests.as_anon();
select ok(public.get_public_tracking((select tracking_token from public.jobs where id = current_setting('t.job')::uuid)) is not null,
          'C5: the shared tracking link works while the job is live');

-- ---------------------------------------------------------------- delivery and confirmation
select tests.as_owner();
select tests.deliver(current_setting('t.job')::uuid);
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.job')::uuid, '000000')) ->> 'ok', 'false', 'C6: a wrong delivery code does not complete the job');
select is((tests.complete(current_setting('t.job')::uuid)) ->> 'ok', 'true', 'C7: the right code completes the job');
select is((tests.complete(current_setting('t.job')::uuid)) ->> 'already', 'true', 'C8: confirming again settles nothing');
select tests.as_owner();
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 29.00::numeric, 'M3: $21 commission charged once ($50 - $21)');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric, 'M4: nothing left held');
select ok(tests.ledger_matches(current_setting('t.drv')::uuid), 'M5: the wallet equals its transactions');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.job')::uuid and type = 'commission'), 1, 'M6: one commission line');

-- ---------------------------------------------------------------- dispute after delivery, resolved by an admin
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.disp', (public.raise_dispute(current_setting('t.job')::uuid, null, 'other', 'Two cubes short on delivery')).id::text, true);
select ok(current_setting('t.disp') <> '', 'C9: the customer raises a problem on the delivered job');
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok($$select public.resolve_dispute(current_setting('t.disp')::uuid, 'no_action', 'Weighbridge slip shows full load')$$,
                'A5: an admin resolves it with a recorded reason');

-- ---------------------------------------------------------------- cancellation releases the reserve
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 200, 'direct')::text, true);
select tests.login_as(current_setting('t.drv')::uuid);
insert into public.bids (job_id, driver_id, price, truck_id)
  values (current_setting('t.job2')::uuid, current_setting('t.drv')::uuid, 200, tests.truck_of(current_setting('t.drv')::uuid));
select tests.as_owner();
select set_config('t.bid2', (select id::text from public.bids where job_id = current_setting('t.job2')::uuid), true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid2')::uuid);
select lives_ok($$select public.cancel_job(current_setting('t.job2')::uuid, 'Plans changed')$$, 'C10: the customer cancels before loading');
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric, 'M7: the $14 reserve is released in full');
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 29.00::numeric, 'M8: no fee was charged');

-- ---------------------------------------------------------------- reconciliation
select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'held_commission_matches_jobs', 'withdrawal_reserved_matches_pending') and not ok), 0,
          'R1: ledger, reserve and withdrawal checks pass after the journeys');

select * from finish();
rollback;
