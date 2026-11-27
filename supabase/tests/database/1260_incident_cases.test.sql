-- 0192: incidents and appeals on the existing reports. Reference, severity, affected party, both sides' statements,
-- conflict-free reviewers, reasoned decisions with a policy, one appeal by a different admin, closed means closed,
-- dispute appeals through the same flow, nobody suspended automatically.
begin;
select plan(34);
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
select tests.enable_launch_features();

select tests.as_owner();
select set_config('t.cust',  tests.create_user('ic_cust')::text, true);
select set_config('t.drv',   tests.create_driver('ic_drv', 100)::text, true);
select set_config('t.other', tests.create_user('ic_other')::text, true);
select set_config('t.a1',    tests.create_user('ic_admin1', array['admin'])::text, true);
select set_config('t.a2',    tests.create_user('ic_admin2', array['admin'])::text, true);
select set_config('t.adrv',  tests.create_driver('ic_admin_driver', 100)::text, true);   -- an admin who drives
insert into public.user_roles (user_id, role) values (current_setting('t.adrv')::uuid, 'admin');
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 300)::text, true);
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 300)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_owner();
select set_config('t.status_before', (select string_agg(id::text || coalesce(status::text, ''), ',' order by id) from public.profiles), true);

-- ============================================================ A. reporting
select tests.login_as(current_setting('t.cust')::uuid);
insert into public.reports (user_id, job_id, description, category)
values (current_setting('t.cust')::uuid, current_setting('t.job')::uuid, 'The driver hit a wall while reversing; my worker was hurt', 'accident_injury');
select set_config('t.r', (select id::text from public.reports where user_id = current_setting('t.cust')::uuid order by created_at desc limit 1), true);
select ok((select case_ref ~ '^INC-[0-9]{6}$' from public.reports where id = current_setting('t.r')::uuid), '1: the case gets a reference');
select is((select severity from public.reports where id = current_setting('t.r')::uuid), 'critical', '2: an injury is critical');
select is((select affected_user_id from public.reports where id = current_setting('t.r')::uuid), current_setting('t.drv')::uuid, '3: the driver is recorded as affected');
select tests.as_owner();
select ok((select urgent from public.reports where id = current_setting('t.r')::uuid), '4: it is urgent');
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.a1')::uuid and title like 'Urgent report INC-%'), '5: admins are alerted');
select is((select action from public.case_events where report_id = current_setting('t.r')::uuid), 'reported', '6: the history starts');

-- ============================================================ B. both sides are heard
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.reports where id = current_setting('t.r')::uuid), 1, '7: the affected driver can see the case');
select lives_ok(format($$select public.case_add_statement(%L, 'I was reversing slowly; the worker walked behind the truck')$$, current_setting('t.r')),
                '8: the driver gives their side');
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format($$select public.case_add_statement(%L, 'I saw it all')$$, current_setting('t.r')), '42501', null,
                 '9: an unrelated user cannot add to the case');
select is((select count(*)::int from public.reports where id = current_setting('t.r')::uuid), 0, '10: nor read it');

-- ============================================================ C. review without conflicts
select tests.login_as(current_setting('t.a1')::uuid);
select throws_like(format($$select public.admin_case_action(%L, 'assign', null, %L)$$, current_setting('t.r'), current_setting('t.cust')),
                   '%to an admin%', '11: a case is assigned only to an admin');
select tests.login_as(current_setting('t.a1')::uuid);
select lives_ok(format($$select public.admin_case_action(%L, 'assign', null, %L)$$, current_setting('t.r'), current_setting('t.a1')),
                '12: admin 1 takes the case');
select is((select case_status from public.reports where id = current_setting('t.r')::uuid), 'investigating', '13: now investigating');
select throws_like(format($$select public.admin_case_action(%L, 'protective_action', 'x')$$, current_setting('t.r')), '%reason%',
                   '14: a protective action needs details');
select lives_ok(format($$select public.admin_case_action(%L, 'protective_action', 'Driver asked to pause new jobs until we talk to both sides')$$, current_setting('t.r')),
                '15: a protective action is recorded and both parties are told');
select lives_ok(format($$select public.admin_case_action(%L, 'note', 'Called the customer; hospital visit confirmed')$$, current_setting('t.r')),
                '16: an internal note');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.case_events where report_id = current_setting('t.r')::uuid and action = 'note'), 0,
          '17: internal notes stay with admins');
select is((select count(*)::int from public.case_events where report_id = current_setting('t.r')::uuid and action = 'protective_action'), 1,
          '18: the parties see the protective action');

-- ============================================================ D. decision
select tests.login_as(current_setting('t.a1')::uuid);
select throws_like(format($$select public.admin_decide_case(%L, 'Driver at fault', 'short', 'Safety policy')$$, current_setting('t.r')),
                   '%reason%', '19: a decision needs a reason');
select throws_like(format($$select public.admin_decide_case(%L, 'Driver at fault', 'Video and both statements agree', '')$$, current_setting('t.r')),
                   '%policy%', '20: and the policy applied');
select lives_ok(format($$select public.admin_decide_case(%L, 'Driver warned; safety briefing required', 'Both statements agree the worker was behind the truck; reversing without a banksman', 'Safety policy 3: reversing')$$, current_setting('t.r')),
                '21: a reasoned decision');
select throws_ok(format($$update public.reports set decision = 'Nothing happened' where id = %L$$, current_setting('t.r')),
                 '42501', null, '22: the admin cannot edit the decision directly either');
select tests.as_owner();
select throws_like(format($$update public.reports set decision_reason = 'rewritten' where id = %L$$, current_setting('t.r')),
                   '%cannot be rewritten%', '23: a decision cannot be silently rewritten, even by a privileged SQL session');
select ok(exists (select 1 from public.admin_audit_log where action = 'case_decided'), '24: the decision is audited');

-- ============================================================ E. appeal
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.case_appeal(%L, 'unfair')$$, current_setting('t.r')), '%10 characters%', '25: an appeal needs grounds');
select lives_ok(format($$select public.case_appeal(%L, 'The customer''s worker walked into a marked reversing area')$$, current_setting('t.r')),
                '26: the driver appeals');
select throws_like(format($$select public.case_appeal(%L, 'Appealing a second time now')$$, current_setting('t.r')), '%once%', '27: only once');
select tests.login_as(current_setting('t.a1')::uuid);
select throws_like(format($$select public.admin_decide_appeal(%L, 'upheld', 'I stand by my decision')$$, current_setting('t.r')),
                   '%different admin%', '28: the original decider cannot decide the appeal');
select tests.login_as(current_setting('t.a2')::uuid);
select lives_ok(format($$select public.admin_decide_appeal(%L, 'upheld', 'Site photos show no marked area; decision stands')$$, current_setting('t.r')),
                '29: a different admin decides it');
select is((select case_status from public.reports where id = current_setting('t.r')::uuid), 'closed', '30: the case is closed');
select throws_like(format($$select public.admin_case_action(%L, 'note', 'late note added')$$, current_setting('t.r')),
                   '%closed%', '31: a closed case cannot be changed');

-- ============================================================ F. conflicts, dispute appeals, no automatic punishment
select tests.as_owner();
select set_config('t.j2', tests.create_job(current_setting('t.cust')::uuid, 300)::text, true);
update public.jobs set status = 'completed', driver_id = current_setting('t.adrv')::uuid where id = current_setting('t.j2')::uuid;
insert into public.disputes (job_id, raised_by, against, reason, category, status, resolved_at, resolution, outcome)
values (current_setting('t.j2')::uuid, current_setting('t.cust')::uuid, current_setting('t.adrv')::uuid, 'Short load of 4 m3', 'wrong_quantity',
        'resolved', now(), 'No action', 'no_action');
select set_config('t.d', (select id::text from public.disputes where job_id = current_setting('t.j2')::uuid), true);
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.ap', (public.appeal_dispute(current_setting('t.d')::uuid, 'The weighbridge ticket shows 4 m3 short')).id::text, true);
select throws_like(format($$select public.appeal_dispute(%L, 'Appealing the dispute again')$$, current_setting('t.d')), '%already appealed%',
                   '32: one dispute appeal per party');
select tests.login_as(current_setting('t.adrv')::uuid);
select throws_ok(format($$select public.admin_decide_case(%L, 'No change', 'I drove this job and the load was right', 'Disputes policy')$$, current_setting('t.ap')),
                 '42501', null, '33: an admin who was a party to the job cannot decide its appeal');
select tests.as_owner();
select is((select count(*)::int from public.profiles where status is distinct from 'active'
            and id in (current_setting('t.cust')::uuid, current_setting('t.drv')::uuid, current_setting('t.adrv')::uuid)), 0,
          '34: nobody was suspended automatically by any of this');

select * from finish();
rollback;
