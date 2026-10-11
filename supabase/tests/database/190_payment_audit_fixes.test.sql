-- 0093 — payment-audit regressions. Each block failed before the migration:
--   A. two pending withdrawals could exist for one user (race on an unlocked check)
--   B. a dispute could name an uninvolved third user as the respondent
--   C. the direct-pay commission was refunded once per dispute, not once per job
--   D. an admin debit could take a wallet below the funds held for active jobs

begin;
select plan(16);

select set_config('t.cust',  tests.create_user('af_cust')::text, true);
select set_config('t.drv',   tests.create_driver('af_drv', 100)::text, true);
select set_config('t.other', tests.create_user('af_other')::text, true);
select set_config('t.admin', tests.create_user('af_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('af_super', array['super_admin','admin'])::text, true);

-- ===========================================================================
-- A. one pending withdrawal per user (enforced by the database, not by a check)
-- ===========================================================================
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'uq_wd_one_pending_per_user'), 1,
  'A: a unique index admits one pending withdrawal per user');

select tests.login_as(current_setting('t.drv')::uuid);
select public.set_withdrawal_pin('4826');
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '4826')->>'ok')::boolean, true, 'A: first withdrawal request accepted');
select throws_like($$select public.request_withdrawal(10, 'ecocash', '0771234567', '4826')$$,
  '%already have a withdrawal awaiting approval%', 'A: a second request while one is pending is refused');
select tests.as_owner();
select throws_ok(format($$insert into public.wallet_withdrawal_requests (user_id, amount, method, destination) values (%L, 5, 'ecocash', '0771234567')$$, current_setting('t.drv')),
  '23505', null, 'A: even a concurrent insert that skipped the check cannot create a second pending row');

-- ===========================================================================
-- B. disputes can only name the other party of the job
-- ===========================================================================
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bid')), 'setup: customer accepts the bid');
select tests.as_owner();

-- D (setup shared): the driver now has the commission held for this job
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 28.00::numeric, 'setup: $28.00 commission is held for the active job');

select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.raise_dispute(%L, %L, 'other', 'naming someone who is not on this job')$$, current_setting('t.job'), current_setting('t.other')),
  '%must be the customer or the driver%', 'B: a third party cannot be named as the respondent');
select lives_ok(format($$select public.raise_dispute(%L, %L, 'other', 'naming the real driver on this job')$$, current_setting('t.job'), current_setting('t.drv')),
  'B: the real other party can be named');
select tests.as_owner();

-- ===========================================================================
-- D. admin debits cannot dip into held funds
-- ===========================================================================
select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_wallet_adjust(%L, -90, 'other', 'debit that would eat the held commission')$$, current_setting('t.drv')),
  '%below its reserved funds%', 'D: a debit into held funds is refused');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 100.00::numeric, 'D: balance untouched by the refused debit');
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_wallet_adjust(%L, -70, 'other', 'debit that leaves the held commission intact')$$, current_setting('t.drv')),
  'D: a debit that leaves the held amount in place still works');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 30.00::numeric, 'D: balance is 100 - 70, still covering the $28.00 hold');

-- ===========================================================================
-- C. the commission is refunded once per job, however many disputes
-- ===========================================================================
select tests.login_as(current_setting('t.cust')::uuid);
select public.complete_job(current_setting('t.job')::uuid);
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.d2', (public.raise_dispute(current_setting('t.job')::uuid, null, 'other', 'second dispute from the driver'))."id"::text, true);
select tests.as_owner();
select set_config('t.d1', (select id::text from public.disputes where raised_by = current_setting('t.cust')::uuid and job_id = current_setting('t.job')::uuid), true);

select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$select public.resolve_dispute(%L, 'refund', 'commission refunded')$$, current_setting('t.d1')), 'C: first refund outcome resolves');
select throws_like(format($$select public.resolve_dispute(%L, 'refund', 'refunding the same commission again')$$, current_setting('t.d2')),
  '%already been refunded%', 'C: a second refund outcome on the same job is refused');
select tests.as_owner();
select is(tests.balance(current_setting('t.cust')::uuid), 28.00::numeric, 'C: the customer received the $28.00 commission exactly once');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.job')::uuid and type = 'refund'), 1,
  'C: exactly one refund transaction exists for the job');

select * from finish();
rollback;
