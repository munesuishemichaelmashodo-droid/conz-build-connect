-- Order lifecycle guards + the documented first-job-free rule (Terms s.6): the FIRST completed job of a
-- newly verified driver carries no commission, exactly once; every later job pays the flat rate.

begin;
select plan(15);

select set_config('t.cust',  tests.create_user('lf_cust')::text, true);
select set_config('t.cust2', tests.create_user('lf_cust2')::text, true);
select set_config('t.drv',   tests.create_driver('lf_drv', 0, false)::text, true);   -- first_job_free_used = false
select set_config('t.drv2',  tests.create_driver('lf_drv2', 100)::text, true);

-- Job 1: accept -> complete
select set_config('t.j1', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b1', tests.create_bid(current_setting('t.j1')::uuid, current_setting('t.drv')::uuid, 400)::text, true);

-- Cannot complete an unaccepted job
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select tests.complete(%L)$$, current_setting('t.j1')), '%not in progress%', 'An open (unaccepted) job cannot be completed');
select public.accept_bid(current_setting('t.b1')::uuid);
select is(coalesce((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0), 0::numeric, 'First job: nothing is held at acceptance');

-- Status jumps and wrong actors
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$update public.jobs set status = 'completed' where id = %L$$, current_setting('t.j1')), '42501', null, 'A driver cannot set a job to completed directly');
select throws_like(format($$select tests.complete(%L)$$, current_setting('t.j1')), '%Only the customer%', 'A driver cannot complete the job via complete_job');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_like(format($$select tests.complete(%L)$$, current_setting('t.j1')), '%Only the customer%', 'Another customer cannot complete it');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$update public.jobs set status = 'completed', commission = 0 where id = %L$$, current_setting('t.j1')), '42501', null, 'The customer cannot write status/commission directly either');

select tests.complete(current_setting('t.j1')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j1')::uuid), 0::numeric, 'First job: no commission (documented first-job-free policy)');
select ok((select first_job_free_used from public.driver_profiles where user_id = current_setting('t.drv')::uuid), 'The first-job-free allowance is now used');
select is(tests.balance(current_setting('t.drv')::uuid), 0::numeric, 'Wallet unchanged by the free first job');

-- Second job: normal flat 7%
update public.wallets set balance = 100 where user_id = current_setting('t.drv')::uuid;
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.b2', tests.create_bid(current_setting('t.j2')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b2')::uuid);
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 28::numeric, 'Second job: $28 (7%) held at acceptance');
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.j2')::uuid);
select is((tests.complete(current_setting('t.j2')::uuid))->>'already', 'true', 'A second completion is an idempotent no-op');
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.j2')::uuid), 28::numeric, 'Second job: $28 commission recorded');
select is(tests.balance(current_setting('t.drv')::uuid), 72::numeric, 'Commission debited exactly once (100 - 28)');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.j2')::uuid and type = 'commission' and amount <> 0), 1, 'Exactly one commission transaction for the job');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric, 'Hold released after completion');

select * from finish();
rollback;
