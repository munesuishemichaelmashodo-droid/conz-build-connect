-- 0186: each agreement version records the job as it was, cannot be rewritten or deleted by anyone, is refused when
-- the job changed after it was proposed, and every step is in an append-only history.
begin;
select plan(37);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('as_cust')::text, true);
select set_config('t.other', tests.create_user('as_other')::text, true);
select set_config('t.admin', tests.create_user('as_admin', array['admin'])::text, true);
select set_config('t.d',     tests.create_driver('as_d', 200, true)::text, true);
select set_config('t.d2',    tests.create_driver('as_d2', 200, true)::text, true);

select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
update public.jobs set pickup_address = 'Quarry gate, Mabvuku', delivery_address = '14 Example Rd, Borrowdale', preferred_date = current_date + 2
 where id = current_setting('t.job')::uuid;
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
$$;
select set_config('t.money', pg_temp.money(), true);
create or replace function pg_temp.v(_n int) returns public.job_agreements language sql as $$
  select * from public.job_agreements where job_id = current_setting('t.job')::uuid and version = _n $$;

-- ============================================================ A. the record is complete and taken from the job
select tests.login_as(current_setting('t.d')::uuid);
select is((public.propose_job_agreement_full(current_setting('t.job')::uuid, 'ecocash', 'on_delivery', 0, null, null, 'Farai', '0771000111',
          null, 'Free cancellation until loading', 'Tue 7-9am', 'Tue 10-12', null, null,
          'collection_point', 'driver_tips', 'Ask for Mr Moyo at the weighbridge', current_date + 2)).version, 1, '1: the driver proposes version 1');
select tests.as_owner();
select ok((select customer_id = current_setting('t.cust')::uuid and driver_id = current_setting('t.d')::uuid from pg_temp.v(1)),
          '2: customer and driver are recorded');
select ok((select truck_registration like 'TEST-%' and truck_capacity_m3 = 15 and truck_id is not null from pg_temp.v(1)),
          '3: the truck and its capacity come from the accepted offer');
select ok((select material = 'custom' and quantity_m3 = 12 and pickup_address = 'Quarry gate, Mabvuku'
                  and delivery_address = '14 Example Rd, Borrowdale' and preferred_date = current_date + 2 from pg_temp.v(1)),
          '4: material, quantity, places and date come from the job');
select ok((select loading_by = 'collection_point' and offloading_by = 'driver_tips' and collection_instructions like 'Ask for%'
                  and agreed_date = current_date + 2 and cancellation_terms is not null and fare = 100 from pg_temp.v(1)),
          '5: handling, instructions, agreed date, cancellation terms and fare are recorded');
select ok((select content_hash ~ '^[0-9a-f]{64}$' and content_hash = public.job_agreement_content_hash(a) from pg_temp.v(1) a),
          '6: a SHA-256 hash is stored and matches the recorded contents');
select set_config('t.a1', (pg_temp.v(1)).id::text, true);

-- ============================================================ B. nobody rewrites it
select tests.login_as(current_setting('t.d')::uuid);
select throws_ok($$update public.job_agreements set fare = 1$$, '42501', null, '7: a participant cannot update a version directly');
select throws_ok(format($$insert into public.job_agreements (job_id, version, proposed_by, fare, payment_method, payment_timing)
                          values (%L, 9, %L, 1, 'cash', 'on_delivery')$$, current_setting('t.job'), current_setting('t.d')),
                 '42501', null, '8: nor insert one with chosen details');
select tests.as_owner();
select throws_like($$update public.job_agreements set fare = 1 where version = 1 and job_id = current_setting('t.job')::uuid$$,
                   '%cannot be changed%', '9: the guard refuses a content change from a privileged SQL session too (app-level protection)');
select throws_like($$update public.job_agreements set truck_registration = 'FAKE-1' where version = 1 and job_id = current_setting('t.job')::uuid$$,
                   '%cannot be changed%', '10: nor swap the recorded truck');
select throws_like($$delete from public.job_agreements where job_id = current_setting('t.job')::uuid$$,
                   '%cannot be deleted%', '11: nor a delete');
select throws_like($$update public.job_agreements set driver_accepted_at = now() - interval '1 day' where version = 1 and job_id = current_setting('t.job')::uuid$$,
                   '%acceptance cannot be changed%', '12: nor back-date an acceptance');

-- ============================================================ C. only the two parties
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format($$select public.accept_job_agreement(%L)$$, current_setting('t.a1')), '42501', null, '13: an unrelated user cannot accept');
select throws_ok(format($$select public.propose_job_agreement_full(%L, 'cash', 'on_delivery')$$, current_setting('t.job')), '42501', null,
                 '14: nor propose');
select is((select count(*)::int from public.job_agreements), 0, '15: nor read any version');
select is((select count(*)::int from public.job_agreement_events), 0, '16: nor read the history');
select throws_ok(format($$select public.job_agreement_in_force(%L)$$, current_setting('t.job')), '42501', null, '17: nor see what is in force');
select tests.login_as(current_setting('t.d2')::uuid);
select throws_ok(format($$select public.accept_job_agreement(%L)$$, current_setting('t.a1')), '42501', null, '18: another driver cannot accept for this job');

-- ============================================================ D. a change to the job needs a new version
select tests.as_owner();
update public.jobs set quantity_m3 = 8 where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.accept_job_agreement(%L)$$, (pg_temp.v(1)).id), '%quantity_m3%',
                   '19: a version proposed before the quantity changed cannot be accepted');
select throws_ok(format($$select public.propose_job_agreement_full(%L, 'cash', 'on_delivery', 30)$$, current_setting('t.job')), 'P0001',
                 'Only the driver can propose or change a deposit', '20: the customer still cannot set a deposit');
select throws_like(format($$select public.propose_job_agreement_full(%L, 'cash', 'on_delivery', 0, null, null, null, null, null, null, null, null, null, null, 'neighbour')$$,
                          current_setting('t.job')), '%who loads%', '21: an unknown loading choice is refused');
select is((public.propose_job_agreement_full(current_setting('t.job')::uuid, 'ecocash', 'on_delivery', 0, null, null, null, null, null,
          'Free cancellation until loading', null, null, null, null, 'collection_point', 'driver_tips', null, current_date + 2)).version, 2,
          '22: the customer proposes version 2 with the new quantity');
select tests.as_owner();
select is((select quantity_m3 from pg_temp.v(2)), 8.00, '23: version 2 records 8 m3');
select is((select status from pg_temp.v(1)), 'superseded', '24: version 1 is kept, marked superseded');
select is((select recipient_name from pg_temp.v(2)), 'Farai', '25: the driver''s payment recipient carries over');
select tests.login_as(current_setting('t.d')::uuid);
select lives_ok(format($$select public.accept_job_agreement(%L)$$, (pg_temp.v(2)).id), '26: the driver accepts version 2');
select is((select jsonb_array_length(public.job_agreement_in_force(current_setting('t.job')::uuid)->'changed_since_agreed')), 0,
          '27: nothing has changed since it was agreed');

-- after acceptance: a change is flagged to both, recorded, and the old acceptance is not silently reused
select tests.as_owner();
update public.jobs set delivery_address = '99 Other Rd, Avondale' where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.job_agreement_in_force(current_setting('t.job')::uuid)->'changed_since_agreed')::text, '["delivery_address"]',
          '28: the in-force view shows which agreed detail changed');
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.cust')::uuid and title = 'Job details changed after you agreed'),
          '29: the parties are told to confirm again');

-- a newer accepted version supersedes the older accepted one; both are kept
select is((public.propose_job_agreement_terms(current_setting('t.job')::uuid, 'ecocash', 'on_delivery', 0)).version, 3,
          '30: the 0179 entry point still proposes');
select tests.login_as(current_setting('t.d')::uuid);
select lives_ok(format($$select public.accept_job_agreement(%L)$$, (pg_temp.v(3)).id), '31: the driver accepts version 3');
select tests.as_owner();
select ok((select status = 'superseded' from pg_temp.v(2)) and (select status = 'accepted' and loading_by = 'collection_point'
           and delivery_address = '99 Other Rd, Avondale' from pg_temp.v(3)),
          '32: version 2 is superseded and kept; version 3 carries the handling details and the new address');

-- ============================================================ E. history
select is((select string_agg(action || ':' || actor_role || ':' || coalesce(version::text, '-'), ',' order by id)
             from public.job_agreement_events where job_id = current_setting('t.job')::uuid),
          'proposed:driver:1,superseded:customer:1,proposed:customer:2,accepted:driver:2,job_details_changed:system:2,proposed:customer:3,superseded:driver:2,accepted:driver:3',
          '33: every step is in the history with who did it');
select throws_like($$delete from public.job_agreement_events$$, '%history cannot be changed%', '34: the history cannot be deleted');

select ok((select bool_and(content_hash = public.job_agreement_content_hash(a)) from public.job_agreements a
            where job_id = current_setting('t.job')::uuid),
          '35: after accepts and supersedes, every stored hash still matches its version (status changes are not contents)');
-- what the hash is for: a change made with the guard switched off (superuser/owner access) is detectable
alter table public.job_agreements disable trigger trg_job_agreement_immutable;
update public.job_agreements set fare = 1 where job_id = current_setting('t.job')::uuid and version = 1;
alter table public.job_agreements enable trigger trg_job_agreement_immutable;
select ok((select content_hash <> public.job_agreement_content_hash(a) from pg_temp.v(1) a),
          '36: an edit made by switching the guard off no longer matches its stored hash');
select is(pg_temp.money(), current_setting('t.money'), '37: no balance, wallet entry or payment changed');

select * from finish();
rollback;
