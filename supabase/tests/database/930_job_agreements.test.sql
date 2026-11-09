-- 0157: the agreement card. Fare comes from the job; both sides accept; versions are kept; only participants and
-- admins can read; nothing about money moves.
begin;
select plan(22);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('ag_cust')::text, true);
select set_config('t.other', tests.create_user('ag_other')::text, true);
select set_config('t.admin', tests.create_user('ag_admin', array['admin'])::text, true);
select set_config('t.d',     tests.create_driver('ag_d', 200, true)::text, true);

select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
do $$
declare b uuid;
begin
  b := tests.create_bid(current_setting('t.job')::uuid, current_setting('t.d')::uuid, 100);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(b);
  perform tests.as_owner();
end $$;

create or replace function pg_temp.money() returns text language sql as $$
  select coalesce((select string_agg(user_id::text || ':' || balance::text || ':' || coalesce(held, 0)::text, ',' order by user_id) from public.wallets), '')
         || '|' || (select count(*) from public.wallet_transactions)::text || '|' || (select count(*) from public.payments)::text
         || '|' || (select coalesce(final_price, budget)::text || ':' || coalesce(held_commission::text, 'n') from public.jobs where id = current_setting('t.job')::uuid)
$$;
select set_config('t.money', pg_temp.money(), true);

-- driver proposes
select tests.login_as(current_setting('t.d')::uuid);
select is((public.propose_job_agreement(current_setting('t.job')::uuid, 'ecocash', 'on_delivery', 20, 'Tue morning', 'Tue afternoon', 'Loading and offloading', 'Waiting time over 30 min')).version, 1, 'the driver proposes version 1');
select is((select fare from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 1), 100.00, 'the fare is copied from the job, not typed');
select ok((select driver_accepted_at is not null and customer_accepted_at is null from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 1), 'the proposer is accepted, the other side is not yet');
select throws_ok(format($$select public.accept_job_agreement(%L)$$, (select id from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 1)), null, 'The other person has to confirm your proposal', 'you cannot accept your own proposal');

-- customer changes it: new version, old kept
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.propose_job_agreement(%L, 'cash', 'on_delivery', 0)$$, current_setting('t.job')), null, 'Only the driver can propose or change a deposit', 'a customer cannot remove the driver''s deposit');
select throws_ok(format($$select public.propose_job_agreement(%L, 'cash', 'on_delivery', 50)$$, current_setting('t.job')), null, 'Only the driver can propose or change a deposit', 'a customer cannot raise the deposit');
select is((public.propose_job_agreement(current_setting('t.job')::uuid, 'cash', 'on_delivery', 20, 'Tue morning', null, 'Loading and offloading', null)).version, 2, 'the customer proposes a changed version 2');
select is((select status from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 1), 'superseded', 'version 1 is kept as history');
select is((select deposit_amount from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 2), 20.00, 'the customer''s version keeps the driver''s deposit');
-- a customer proposing the first version of an agreement can only have no deposit
select throws_ok(format($$select public.propose_job_agreement(%L, 'cash', 'on_delivery', 10)$$, current_setting('t.job')), null, 'Only the driver can propose or change a deposit', 'a customer cannot set a deposit that the driver did not propose');

-- driver accepts v2
select tests.login_as(current_setting('t.d')::uuid);
select is((public.accept_job_agreement((select id from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 2))).status, 'accepted', 'the driver accepts version 2');
select ok((select customer_accepted_at is not null and driver_accepted_at is not null from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 2), 'both acceptance times are recorded');
select throws_ok(format($$select public.accept_job_agreement(%L)$$, (select id from public.job_agreements where job_id = current_setting('t.job')::uuid and version = 2)), null, 'This version is no longer open', 'an accepted version cannot be accepted again');

-- the driver can change the deposit in a later version
select is((public.propose_job_agreement(current_setting('t.job')::uuid, 'cash', 'on_delivery', 30)).deposit_amount, 30.00, 'the driver can change the deposit in a new version');

-- validation
select throws_ok(format($$select public.propose_job_agreement(%L, 'cash', 'on_delivery', 500)$$, current_setting('t.job')), null, 'The deposit cannot be more than the fare', 'a deposit above the fare is refused');
select throws_ok(format($$select public.propose_job_agreement(%L, 'bitcoin', 'on_delivery', 0)$$, current_setting('t.job')), '23514', null, 'an unknown payment method is refused');

-- visibility and direct writes
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.job_agreements), 0, 'an unrelated user reads no agreements');
select throws_ok(format($$select public.propose_job_agreement(%L, 'cash', 'on_delivery', 0)$$, current_setting('t.job')), null, 'Only the customer or the driver of this job can do that', 'an unrelated user cannot propose');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*)::int from public.job_agreements where job_id = current_setting('t.job')::uuid), 3, 'an admin can read every version');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$update public.job_agreements set fare = 1 where job_id = %L$$, current_setting('t.job')), '42501', null, 'nobody can edit an agreement row directly');
select throws_ok(format($$select public.propose_job_agreement(%L, 'cash', 'on_delivery', 0)$$, current_setting('t.job2')), null, 'The agreement can only be set while the job is assigned and not yet finished', 'a job that is not assigned has no agreement');

-- money untouched
select tests.as_owner();
select is(pg_temp.money(), current_setting('t.money'), 'no wallet, ledger, payment, price or reserve changed');

select * from finish();
rollback;
