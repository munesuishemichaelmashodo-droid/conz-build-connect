-- 0142: support-report privacy and replies, admin cancellation validation and audit, admin search.
begin;
select plan(46);

select set_config('t.cust',  tests.create_user('rpt_cust')::text, true);
select set_config('t.other', tests.create_user('rpt_other')::text, true);
select set_config('t.adm',   tests.create_user('rpt_admin', array['admin'])::text, true);
select set_config('t.sup',   tests.create_user('rpt_super', array['super_admin','admin'])::text, true);

-- ============ Support reports ============
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$insert into public.reports (user_id, description) values (%L, 'The driver was rude to me')$$, current_setting('t.cust')), 'a customer can file a report');
select throws_ok(format($$insert into public.reports (user_id, description, status, admin_notes) values (%L, 'x', 'resolved', 'forged')$$, current_setting('t.cust')), '42501', null, 'a customer cannot set status or admin fields on insert');
select throws_ok($$select admin_notes from public.reports$$, '42501', null, 'a customer cannot read the private note column');
select throws_ok($$select * from public.reports$$, '42501', null, 'select * is refused for customers (it includes the private column)');
select throws_ok(format($$update public.reports set status = 'resolved' where user_id = %L$$, current_setting('t.cust')), '42501', null, 'a customer cannot update a report');
select is((select count(*)::int from (select id, description, status, admin_reply, admin_reply_at, created_at from public.reports) s), 1, 'a customer reads their own report columns');
select throws_ok($$select * from public.admin_list_reports()$$, 'P0001', 'Forbidden', 'a customer cannot list reports as an admin');
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from (select id from public.reports) s), 0, 'another customer sees nobody else''s report');
select tests.as_owner();
select set_config('t.rep', (select id::text from public.reports where user_id = current_setting('t.cust')::uuid limit 1), true);

select tests.login_as(current_setting('t.adm')::uuid);
select is((public.admin_respond_to_report(current_setting('t.rep')::uuid, 'We have spoken to the driver.', 'Two prior warnings - internal', null)->>'changed')::boolean, true, 'an admin reply is saved');
select is((select admin_notes from public.admin_list_reports() where id = current_setting('t.rep')::uuid), 'Two prior warnings - internal', 'the admin list includes the private note');
select tests.as_owner();
select is((select count(*)::int from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'report_update'), 1, 'the reporter is notified once');
select is((select body from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'report_update'), 'We have spoken to the driver.', 'the notification carries the reply, not the private note');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select admin_reply from public.reports limit 1), 'We have spoken to the driver.', 'the customer reads the reply');
select throws_ok($$select admin_notes from public.reports$$, '42501', null, 'the customer still cannot read the private note');
select tests.login_as(current_setting('t.adm')::uuid);
select is((public.admin_respond_to_report(current_setting('t.rep')::uuid, 'We have spoken to the driver.', 'Two prior warnings - internal', null)->>'changed')::boolean, false, 'saving the same reply again changes nothing');
select tests.as_owner();
select is((select count(*)::int from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'report_update'), 1, 'and sends no second notification');
select tests.login_as(current_setting('t.adm')::uuid);
select public.admin_respond_to_report(current_setting('t.rep')::uuid, null, 'edited private note only', null);
select tests.as_owner();
select is((select count(*)::int from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'report_update'), 1, 'a private-note edit does not notify the customer');
select tests.login_as(current_setting('t.sup')::uuid);
select public.admin_respond_to_report(current_setting('t.rep')::uuid, null, null, 'resolved');
select tests.as_owner();
select is((select count(*)::int from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'report_update'), 2, 'resolving notifies the customer once more');
select is((select status from public.reports where id = current_setting('t.rep')::uuid), 'resolved', 'and updates the status');
select is((select count(*)::int from public.admin_audit_log where action = 'report_updated' and target_id = current_setting('t.rep')::uuid), 3, 'each real change is in the audit log');
select is((select count(*)::int from public.admin_audit_log where action = 'report_updated' and meta::text like '%internal%'), 0, 'the audit entries do not copy the private note text');
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$select public.admin_respond_to_report(%L, null, null, 'deleted')$$, current_setting('t.rep')), 'P0001', 'Invalid status', 'an invalid status is rejected');
select tests.as_owner();

-- ============ Admin cancellation ============
select set_config('t.job1', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select set_config('t.job2', tests.create_job(current_setting('t.cust')::uuid, 200)::text, true);
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$select public.cancel_job(%L)$$, current_setting('t.job1')), 'P0001', 'A reason of at least 5 characters is required to cancel as an admin', 'an admin cancellation without a reason is refused by the database');
select throws_ok(format($$select public.cancel_job(%L, 'abc')$$, current_setting('t.job1')), 'P0001', 'A reason of at least 5 characters is required to cancel as an admin', 'a three-character reason is refused');
select lives_ok(format($$select public.cancel_job(%L, 'Customer asked us to cancel by phone')$$, current_setting('t.job1')), 'an admin can cancel with a reason');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.job1')::uuid), 'cancelled', 'the job is cancelled');
select is((select cancelled_by from public.jobs where id = current_setting('t.job1')::uuid), current_setting('t.adm')::uuid, 'the administrator is recorded');
select ok((select cancelled_at is not null from public.jobs where id = current_setting('t.job1')::uuid), 'with a timestamp');
select is((select count(*)::int from public.admin_audit_log where action = 'job_cancelled_by_admin' and actor_id = current_setting('t.adm')::uuid and target_id = current_setting('t.job1')::uuid and target_user_id = current_setting('t.cust')::uuid and meta->>'previous_status' = 'open' and reason = 'Customer asked us to cancel by phone'), 1, 'the audit log has actor, job, customer, previous status and reason');
select is((select job_id from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'job_cancelled'), current_setting('t.job1')::uuid, 'the customer is notified and the notification opens the job');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.cancel_job(%L)$$, current_setting('t.job2')), 'a customer can still cancel their own open job without a reason');
select tests.as_owner();
select is((select count(*)::int from public.admin_audit_log where action = 'job_cancelled_by_admin'), 1, 'and that writes no admin audit entry');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.cancel_job(%L, 'already gone')$$, current_setting('t.job1')), 'P0001', null, 'a cancelled job cannot be cancelled again');
select tests.as_owner();

-- ============ Admin search ============
select tests.create_user('zzpg ' || g) from generate_series(1, 25) g;
select tests.create_job(current_setting('t.cust')::uuid, 400) from generate_series(1, 210);
update public.jobs set delivery_address = 'Needle Street 77', created_at = now() - interval '400 days'
 where id = (select id from public.jobs where customer_id = current_setting('t.cust')::uuid order by created_at limit 1);
update public.wallets set balance = 35 where user_id = current_setting('t.cust')::uuid;
insert into public.wallet_transactions (user_id, type, amount, balance_after, note, created_at)
values (current_setting('t.cust')::uuid, 'topup', 30, 30, 'old topup NEEDLEFIN', now() - interval '10 days'),
       (current_setting('t.cust')::uuid, 'topup', 5, 35, 'today topup NEEDLEFIN', now());

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select * from public.admin_search('rpt_cust')$$, 'P0001', 'Forbidden', 'a customer cannot search');
select tests.login_as(current_setting('t.adm')::uuid);
select ok(exists (select 1 from public.admin_search('rpt_cust', 'customers') where kind = 'customers'), 'finds a customer by name');
select ok(exists (select 1 from public.admin_search('Needle Street', 'jobs') where kind = 'jobs'), 'finds a job beyond the old 200-newest browser window');
select is((select count(*)::int from public.admin_search('zzpg', 'customers', 10, 20)), 5, 'page 3 of 10 over 25 customers has 5 rows');
select is((select max(total_count)::int from public.admin_search('zzpg', 'customers', 10, 20)), 25, 'and every row carries the full total');
select is((select count(distinct id)::int from (select id from public.admin_search('zzpg','customers',10,0) union all select id from public.admin_search('zzpg','customers',10,10) union all select id from public.admin_search('zzpg','customers',10,20)) s), 25, 'pages do not overlap');
select is((select count(*)::int from public.admin_search('Test address', 'jobs', 1000, 0)), 50, 'the page size is capped at 50');
select is((select count(*)::int from public.admin_search('NEEDLEFIN', 'transactions')), 1, 'an ordinary admin sees only today''s wallet transactions');
select lives_ok($$select * from public.admin_search('anything', 'payments')$$, 'payments are searchable by an admin');
select is((select count(*)::int from public.admin_search('%%')), 0, 'wildcard characters are searched literally');
select throws_ok($$select * from public.admin_search('a')$$, 'P0001', 'Type at least 2 characters to search', 'a one-character search is refused');
select throws_ok($$select * from public.admin_search('abc', 'everything')$$, 'P0001', 'Unknown search type', 'an unknown search type is refused');
select tests.login_as(current_setting('t.sup')::uuid);
select is((select count(*)::int from public.admin_search('NEEDLEFIN', 'transactions')), 2, 'a super admin sees all wallet transactions');
select tests.as_owner();

select * from finish();
rollback;
