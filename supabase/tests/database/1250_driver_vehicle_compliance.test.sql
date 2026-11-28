-- 0191: one record per driver/vehicle document; only an admin review marks it checked; records and history cannot be
-- rewritten; customers see checked, unexpired facts only; expiry reminders once; an expired checked licence blocks new
-- offers; nothing else is suspended automatically.
begin;
select plan(30);
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
select tests.enable_launch_features();

select tests.as_owner();
select set_config('t.drv',   tests.create_driver('cp_drv', 100)::text, true);
select set_config('t.drv2',  tests.create_driver('cp_drv2', 100)::text, true);
select set_config('t.cust',  tests.create_user('cp_cust')::text, true);
select set_config('t.admin', tests.create_user('cp_admin', array['admin'])::text, true);
select set_config('t.truck', tests.truck_of(current_setting('t.drv')::uuid)::text, true);
select set_config('t.truck2', tests.truck_of(current_setting('t.drv2')::uuid)::text, true);
insert into storage.objects (bucket_id, name) values
  ('driver-docs', current_setting('t.drv') || '/licence-1.jpg'),
  ('driver-docs', current_setting('t.drv') || '/licence-2.jpg'),
  ('driver-docs', current_setting('t.drv') || '/insurance-1.pdf'),
  ('driver-docs', current_setting('t.drv') || '/id-1.jpg'),
  ('driver-docs', current_setting('t.drv2') || '/licence-1.jpg');

-- ============================================================ A. submitting
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.lic', (public.submit_compliance_document('driving_licence', current_setting('t.drv') || '/licence-1.jpg',
  current_date + 400, 'C', null, null, '7G2K')).id::text, true);
select is((select status from public.driver_compliance_documents where id = current_setting('t.lic')::uuid), 'submitted',
          '1: an uploaded licence is only "submitted"');
select is((select state from public.driver_compliance_summary() where doc_type = 'driving_licence'), 'pending', '2: shown to the driver as pending');
select is((select count(*)::int from public.driver_compliance_badges(current_setting('t.drv')::uuid)), 0, '3: and no badge');
select throws_ok(format($$select public.submit_compliance_document('driving_licence', %L)$$, current_setting('t.drv2') || '/licence-1.jpg'),
                 '42501', null, '4: a driver cannot submit someone else''s file');
select throws_like(format($$select public.submit_compliance_document('identity', %L)$$, current_setting('t.drv') || '/missing.jpg'),
                   '%own documents%', '5: nor a file that was never uploaded');
select throws_ok(format($$select public.submit_compliance_document('insurance', %L, current_date + 100, null, 'goods_in_transit', %L)$$,
                        current_setting('t.drv') || '/insurance-1.pdf', current_setting('t.truck2')),
                 '42501', null, '6: nor attach a document to another driver''s truck');
select throws_like(format($$select public.submit_compliance_document('insurance', %L, current_date - 1, null, 'third_party', %L)$$,
                          current_setting('t.drv') || '/insurance-1.pdf', current_setting('t.truck')),
                   '%already expired%', '7: an expired document is refused at submission');
select set_config('t.ins', (public.submit_compliance_document('insurance', current_setting('t.drv') || '/insurance-1.pdf',
  current_date + 20, null, 'goods_in_transit', current_setting('t.truck')::uuid)).id::text, true);
select throws_ok(format($$update public.driver_compliance_documents set status = 'checked' where id = %L$$, current_setting('t.lic')),
                 '42501', null, '8: a driver cannot mark their own document checked');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.submit_compliance_document('identity', 'x/y.jpg')$$, '42501', null, '9: a customer cannot submit driver documents');
select is((select count(*)::int from public.driver_compliance_documents), 0, '10: nor read them');

-- ============================================================ B. review
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.admin_review_compliance_document(%L, 'checked')$$, current_setting('t.lic')), '42501', null,
                 '11: a driver cannot review');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_review_compliance_document(%L, 'rejected', 'no')$$, current_setting('t.lic')), '%reason%',
                   '12: rejecting needs a reason');
select throws_like(format($$select public.admin_review_compliance_document(%L, 'checked', null, current_date - 1)$$, current_setting('t.ins')),
                   '%expired; reject it instead%', '13: a reviewer cannot record an expiry date that has passed');
select lives_ok(format($$select public.admin_review_compliance_document(%L, 'checked', 'Licence matches ID; class C', current_date + 400, 'C')$$,
                       current_setting('t.lic')), '14: an admin checks the licence with its class and expiry');
select throws_like(format($$select public.admin_review_compliance_document(%L, 'rejected', 'changed my mind')$$, current_setting('t.lic')),
                   '%already reviewed%', '15: a review cannot be changed afterwards');
select tests.as_owner();
select throws_like(format($$update public.driver_compliance_documents set expires_on = current_date + 900 where id = %L$$, current_setting('t.lic')),
                   '%cannot be changed%', '16: a reviewed record''s facts cannot be edited, even by a privileged SQL session');
select throws_like(format($$delete from public.driver_compliance_documents where id = %L$$, current_setting('t.lic')), '%kept%',
                   '17: nor deleted');
select ok(exists (select 1 from public.admin_audit_log where action = 'compliance_document_checked'), '18: the review is in the audit log');

-- ============================================================ C. what others see
select tests.login_as(current_setting('t.cust')::uuid);
select is((select doc_type || ':' || licence_class from public.driver_compliance_badges(current_setting('t.drv')::uuid)), 'driving_licence:C',
          '19: a customer sees "licence checked, class C" and nothing else (insurance was only submitted)');
select tests.as_anon();
select throws_ok(format($$select * from public.driver_compliance_badges(%L)$$, current_setting('t.drv')), '42501', null,
                 '20: signed-out visitors see nothing');

-- ============================================================ D. supersede, history, expiry
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.lic2', (public.submit_compliance_document('driving_licence', current_setting('t.drv') || '/licence-2.jpg',
  current_date + 800, 'C')).id::text, true);
select is((select status from public.driver_compliance_documents where id = current_setting('t.lic')::uuid), 'superseded',
          '21: a new submission supersedes the previous one (kept)');
select is((select count(*)::int from public.driver_compliance_documents where driver_id = current_setting('t.drv')::uuid), 3,
          '22: every record is kept');
select tests.as_owner();
select throws_like($$delete from public.driver_compliance_events$$, '%cannot be changed%', '23: history cannot be deleted');
-- insurance checked, then near expiry
select tests.login_as(current_setting('t.admin')::uuid);
select public.admin_review_compliance_document(current_setting('t.ins')::uuid, 'checked', 'Goods in transit, insurer letter', current_date + 20);
select tests.as_service();
select is(public.compliance_expiry_sweep(), 1, '24: the sweep sends the 30-day reminder');
select is(public.compliance_expiry_sweep(), 0, '25: once only');

-- ============================================================ E. the one restriction
select tests.as_owner();
-- the driver's current licence (lic2) checked, then time passes: simulate by back-dating the reviewed record with the guard off
select tests.login_as(current_setting('t.admin')::uuid);
select public.admin_review_compliance_document(current_setting('t.lic2')::uuid, 'checked', 'Renewed licence', current_date + 800, 'C');
select tests.as_owner();
alter table public.driver_compliance_documents disable trigger trg_compliance_document_guard;
update public.driver_compliance_documents set expires_on = current_date - 1 where id = current_setting('t.lic2')::uuid;
alter table public.driver_compliance_documents enable trigger trg_compliance_document_guard;
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select throws_like(format($$select tests.create_bid(%L, %L, 200)$$, current_setting('t.job'), current_setting('t.drv')),
                   '%driving licence on record expired%', '26: an expired checked licence blocks new offers');
select lives_ok(format($$select tests.create_bid(%L, %L, 200)$$, current_setting('t.job'), current_setting('t.drv2')),
                '27: a driver with no licence record is not restricted by this rule');
select is((select verification_status from public.driver_profiles where user_id = current_setting('t.drv')::uuid), 'verified',
          '28: nothing is suspended automatically');
select tests.as_service();
select ok(public.compliance_expiry_sweep() >= 1, '29: the expiry is announced');
select tests.as_owner();
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.drv')::uuid and title = 'A document has expired'
                    and body like '%cannot send new offers%'), '30: the driver is told why and what to do');

select * from finish();
rollback;
