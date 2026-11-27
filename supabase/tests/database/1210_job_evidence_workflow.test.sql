-- 0187: collection and delivery evidence. Reports are tied to the right job, person and role; photos of another job or
-- person cannot be attached; photo records and stored files cannot be silently replaced; corrections keep history;
-- the delivery code locks out guessing; the final record separates submitted material from system checks.
begin;
select plan(42);
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('ev_cust')::text, true);
select set_config('t.cust2', tests.create_user('ev_cust2')::text, true);
select set_config('t.admin', tests.create_user('ev_admin', array['admin'])::text, true);
select set_config('t.drv',   tests.create_driver('ev_drv', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('ev_drv2', 100)::text, true);

select set_config('t.job',  tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.job2', tests.create_job(current_setting('t.cust2')::uuid, 400)::text, true);
select set_config('t.bid',  tests.create_bid(current_setting('t.job')::uuid,  current_setting('t.drv')::uuid, 380)::text, true);
select set_config('t.bid2', tests.create_bid(current_setting('t.job2')::uuid, current_setting('t.drv2')::uuid, 380)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.login_as(current_setting('t.cust2')::uuid);
select public.accept_bid(current_setting('t.bid2')::uuid);
select tests.as_owner();
insert into storage.objects (bucket_id, name) values
  ('job-proof-photos', current_setting('t.job') || '/pickup-1.jpg'),
  ('job-proof-photos', current_setting('t.job') || '/pickup-2.jpg'),
  ('job-proof-photos', current_setting('t.job') || '/delivery-1.jpg'),
  ('job-proof-photos', current_setting('t.job2') || '/pickup-1.jpg');
create or replace function pg_temp.money() returns text language sql as $$
  select coalesce((select string_agg(user_id::text || ':' || balance::text || ':' || coalesce(held, 0)::text, ',' order by user_id) from public.wallets), '')
         || '|' || (select count(*) from public.wallet_transactions)::text $$;

-- ============================================================ A. collection
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.report_job_stage(%L, 'collection_confirmed', null, 'as_agreed', 12)$$, current_setting('t.job')),
                   '%collection photo first%', '1: a collection cannot be confirmed before the collection photo');
select set_config('t.p1', (public.record_job_evidence(current_setting('t.job')::uuid, 'pickup', current_setting('t.job') || '/pickup-1.jpg',
  null, 'image/jpeg', -17.75, 31.02, 10, 'captured')).id::text, true);
select throws_like(format($$select public.report_job_stage(%L, 'collection_confirmed', null, null, 12)$$, current_setting('t.job')),
                   '%looks like%', '2: the visible condition is required');
select throws_like(format($$select public.report_job_stage(%L, 'collection_confirmed', null, 'as_agreed', null)$$, current_setting('t.job')),
                   '%quantity loaded%', '3: the quantity loaded is required');
select lives_ok(format($$select public.report_job_stage(%L, 'collection_confirmed', null, 'as_agreed', 12, null, 'Loaded at the quarry', %L)$$,
                       current_setting('t.job'), current_setting('t.p1')), '4: the driver confirms 12 m3 loaded, as agreed, with the photo');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.report_job_stage(%L, 'collection_confirmed', null, 'as_agreed', 12)$$, current_setting('t.job')),
                 '42501', null, '5: a customer cannot confirm a collection (fake collection)');
select tests.login_as(current_setting('t.drv2')::uuid);
select throws_ok(format($$select public.report_job_stage(%L, 'collection_confirmed', null, 'as_agreed', 12)$$, current_setting('t.job')),
                 '42501', null, '6: another driver cannot report on this job');
select set_config('t.other_photo', (public.record_job_evidence(current_setting('t.job2')::uuid, 'pickup', current_setting('t.job2') || '/pickup-1.jpg')).id::text, true);
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.report_job_stage(%L, 'collection_problem', 'quantity_short', null, 10, null, 'Quarry short', %L)$$,
                        current_setting('t.job'), current_setting('t.other_photo')),
                 '42501', null, '7: a photo from another job cannot be attached');
select throws_like(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job2'), current_setting('t.job2') || '/pickup-1.jpg'),
                 '%Not part of this job%', '8: a driver cannot file evidence on someone else''s job');
select throws_like(format($$select public.record_job_evidence(%L, 'pickup', %L)$$, current_setting('t.job'), current_setting('t.job2') || '/pickup-1.jpg'),
                   '%start with the job id%', '9: nor attach another job''s stored file to this job');
select lives_ok(format($$select public.report_job_stage(%L, 'collection_problem', 'quantity_short', null, 10, null, 'Quarry had only 10 m3')$$,
                       current_setting('t.job')), '10: the driver reports a short load at collection');
select throws_like(format($$select public.report_job_stage(%L, 'collection_problem', 'other')$$, current_setting('t.job')),
                   '%Describe the problem%', '11: "other" needs a description');

-- ============================================================ B. corrections keep history
select set_config('t.p2', (public.record_job_evidence(current_setting('t.job')::uuid, 'pickup', current_setting('t.job') || '/pickup-2.jpg')).id::text, true);
select throws_like(format($$select public.supersede_job_evidence(%L, %L, 'x')$$, current_setting('t.p1'), current_setting('t.p2')),
                   '%why%', '12: replacing a photo needs a reason');
select lives_ok(format($$select public.supersede_job_evidence(%L, %L, 'First photo was blurred')$$, current_setting('t.p1'), current_setting('t.p2')),
                '13: the driver replaces a blurred photo with a newer one, with a reason');
select throws_like(format($$select public.supersede_job_evidence(%L, %L, 'again please')$$, current_setting('t.p1'), current_setting('t.p2')),
                   '%already replaced%', '14: a photo is replaced once');
select tests.as_owner();
select is((select pickup_photo_url from public.jobs where id = current_setting('t.job')::uuid), current_setting('t.job') || '/pickup-1.jpg',
          '15: the original photo stays the job''s photo of record');
select throws_like(format($$update public.job_evidence set superseded_by = null where id = %L$$, current_setting('t.p1')),
                   '%immutable%', '16: the replacement link cannot be undone, even by the owner');
select throws_like(format($$update public.job_evidence set storage_path = 'x/y.jpg' where id = %L$$, current_setting('t.p1')),
                   '%immutable%', '17: a photo record cannot be pointed at another file');
select throws_like(format($$update public.job_evidence set location_status = 'captured', device_accuracy_m = 1 where id = %L$$, current_setting('t.p2')),
                   '%immutable%', '18: nor have its location quality upgraded');
select throws_like(format($$delete from public.job_evidence where id = %L$$, current_setting('t.p1')), '%cannot be deleted%',
                   '19: nor be deleted');
select set_config('t.r_short', (select id::text from public.job_stage_reports where event = 'collection_problem' and job_id = current_setting('t.job')::uuid), true);
select throws_like(format($$update public.job_stage_reports set quantity_m3 = 12 where id = %L$$, current_setting('t.r_short')),
                   '%cannot be changed%', '20: a report cannot be edited');
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$select public.report_job_stage(%L, 'collection_problem', 'quantity_short', null, 11, null, 'Correct figure is 11 m3', null, %L)$$,
                       current_setting('t.job'), current_setting('t.r_short')), '21: a correction is a new report pointing at the old one');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.report_job_stage(%L, 'delivery_problem', 'shortage', null, 8, null, 'x', null, %L)$$,
                        current_setting('t.job'), current_setting('t.r_short')),
                 '42501', null, '22: nobody can "correct" another person''s report');

-- ============================================================ C. stored files
select tests.login_as(current_setting('t.admin')::uuid);
select set_config('storage.allow_delete_query', 'true', true);
update storage.objects set metadata = '{"swapped":true}' where name = current_setting('t.job') || '/pickup-1.jpg';
delete from storage.objects where name = current_setting('t.job') || '/pickup-1.jpg';
select tests.as_owner();
select ok((select metadata->>'swapped' is null from storage.objects where name = current_setting('t.job') || '/pickup-1.jpg'),
          '23: an admin cannot overwrite a stored evidence photo');
select ok(exists(select 1 from storage.objects where name = current_setting('t.job') || '/pickup-1.jpg'),
          '24: nor delete it');
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*)::int from storage.objects where name = current_setting('t.job') || '/pickup-1.jpg'), 1,
          '25: but can still read it');
select tests.login_as(current_setting('t.cust2')::uuid);
select is((select count(*)::int from storage.objects where name like current_setting('t.job') || '/%'), 0,
          '26: another customer cannot see this job''s photos');
select is((select count(*)::int from public.job_stage_reports where job_id = current_setting('t.job')::uuid), 0,
          '27: nor its reports');

-- ============================================================ D. transit, delivery, code
select tests.login_as(current_setting('t.drv')::uuid);
select public.start_trip(current_setting('t.job')::uuid);
select lives_ok(format($$select public.report_job_stage(%L, 'delay', 'breakdown', null, null, 45, 'Tyre change')$$, current_setting('t.job')),
                '28: the driver reports a delay with a new arrival time');
select tests.as_owner();
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.cust')::uuid and title = 'Delivery delayed'),
          '29: the customer is told');
select tests.login_as(current_setting('t.drv')::uuid);
select public.record_job_evidence(current_setting('t.job')::uuid, 'delivery', current_setting('t.job') || '/delivery-1.jpg');
select tests.as_owner();
insert into public.job_delivery_pins (job_id, pin) values (current_setting('t.job')::uuid, '123456') on conflict (job_id) do update set pin = '123456';
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.job')::uuid, '000000'))->>'error', 'wrong_pin',
          '30: a wrong delivery code does not complete the job');
select is((select status::text from public.jobs where id = current_setting('t.job')::uuid), 'in_progress', '31: the job is still in progress');
select lives_ok(format($$select public.report_job_stage(%L, 'delivery_problem', 'partial_delivery', null, 8, null, 'Only 8 m3 arrived')$$,
                       current_setting('t.job')), '32: the customer reports a partial delivery with the quantity received');
select throws_like(format($$select public.report_job_stage(%L, 'delivery_problem', 'shortage')$$, current_setting('t.job')),
                   '%quantity that arrived%', '33: a shortage needs the quantity that arrived');
select tests.as_owner();
insert into public.disputes (job_id, raised_by, against, reason, category)
values (current_setting('t.job')::uuid, current_setting('t.cust')::uuid, current_setting('t.drv')::uuid, 'Load was damaged and short', 'damage');
-- the test transaction has one clock: place the dispute a minute earlier so the next photo is after it
update public.disputes set created_at = now() - interval '1 minute' where job_id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.p3', (select id::text from public.job_evidence where job_id = current_setting('t.job')::uuid and kind = 'delivery'), true);
select tests.as_owner();
insert into storage.objects (bucket_id, name) values ('job-proof-photos', current_setting('t.job') || '/delivery-2.jpg');
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.p4', (public.record_job_evidence(current_setting('t.job')::uuid, 'delivery', current_setting('t.job') || '/delivery-2.jpg')).id::text, true);
select throws_like(format($$select public.supersede_job_evidence(%L, %L, 'Better angle of the pile')$$, current_setting('t.p3'), current_setting('t.p4')),
                   '%dispute%', '34: photos cannot be replaced while a dispute is open (disputed damage)');
select set_config('t.late', (public.report_job_stage(current_setting('t.job')::uuid, 'delivery_problem', 'damage', null, null, null,
  'Driver says the load was dry when tipped')).id::text, true);
select tests.as_owner();
select ok((select filed_during_dispute from public.job_stage_reports where id = current_setting('t.late')::uuid),
          '34b: a report filed while the job has a dispute is stored as filed during the dispute');
select tests.login_as(current_setting('t.cust')::uuid);
select ok((select x->>'verification' = 'statement' and (x->>'added_after_dispute')::boolean and x->>'reviewer_note' like 'Filed after the dispute opened%not independent verification.'
             from public.job_evidence_record(current_setting('t.job')::uuid) r, jsonb_array_elements(r->'reports') x
            where x->>'id' = current_setting('t.late')),
          '34c: in the record it is marked as filed after the dispute and as a statement, not verification');

-- ============================================================ E. the final record
select tests.login_as(current_setting('t.cust')::uuid);
select ok((select r->>'basis' like 'Photos and reports are submitted%' from public.job_evidence_record(current_setting('t.job')::uuid) r),
          '35: the record says photos and reports are not independently verified');
select ok((select (select bool_and(p->>'verification' = 'submitted') from jsonb_array_elements(r->'photos') p)
                  and (select bool_and(x->>'verification' = 'statement') from jsonb_array_elements(r->'reports') x)
             from public.job_evidence_record(current_setting('t.job')::uuid) r),
          '36: photos are "submitted" and reports are "statements"');
select ok((select (select bool_or((p->>'added_after_dispute')::boolean) from jsonb_array_elements(r->'photos') p)
                  and r->'recorded_gps_points' = 'null'::jsonb and r->'delivery_code'->>'verification' = 'not_confirmed'
             from public.job_evidence_record(current_setting('t.job')::uuid) r),
          '37: late photos are marked, GPS counts are admin-only, and the code is not confirmed');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select public.job_evidence_record(%L)$$, current_setting('t.job')), '42501', null,
                 '38: another customer cannot read the record');
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select (r->'delivery_code'->>'wrong_attempts')::int = 1 and r->'recorded_gps_points' is not null
             from public.job_evidence_record(current_setting('t.job')::uuid) r), '39: admins see wrong code attempts and GPS counts');

select tests.as_owner();
select is((select count(*)::int from public.job_stage_reports where job_id = current_setting('t.job')::uuid), 6, '40: six reports, none edited or removed');

select * from finish();
rollback;
