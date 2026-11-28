-- 0193: the admin evidence view is admin-only, logs every access, includes admin decisions on the job and its
-- disputes, and changes nothing. The public tracking link carries no contact details, documents, photos or payments.
begin;
select plan(11);
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
select tests.enable_launch_features();
select tests.as_owner();
select set_config('t.cust',  tests.create_user('ev_cust')::text, true);
select set_config('t.drv',   tests.create_driver('ev_drv', 100)::text, true);
select set_config('t.admin', tests.create_user('ev_admin', array['admin'])::text, true);
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 300)::text, true);
select set_config('t.bid', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 300)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bid')::uuid);
select tests.as_owner();
insert into public.disputes (job_id, raised_by, against, reason, category)
values (current_setting('t.job')::uuid, current_setting('t.cust')::uuid, current_setting('t.drv')::uuid, 'Load arrived wet', 'damage');
select set_config('t.d', (select id::text from public.disputes where job_id = current_setting('t.job')::uuid), true);
insert into public.admin_audit_log (actor_id, action, target_id, reason)
values (current_setting('t.admin')::uuid, 'dispute_investigating', current_setting('t.d')::uuid, 'Asked both for photos');
select set_config('t.jobrow', (select to_jsonb(j)::text from public.jobs j where id = current_setting('t.job')::uuid), true);

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.admin_job_history(%L)$$, current_setting('t.job')), '42501', null, '1: a party cannot open the admin view');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.admin_job_history(%L)$$, current_setting('t.job')), '42501', null, '2: nor the driver');
select tests.as_anon();
select throws_ok(format($$select public.admin_job_history(%L)$$, current_setting('t.job')), '42501', null, '3: nor a signed-out visitor');

select tests.login_as(current_setting('t.admin')::uuid);
select set_config('t.h', public.admin_job_history(current_setting('t.job')::uuid)::text, true);
select ok((current_setting('t.h')::jsonb -> 'timeline') @> '[{"step":"created_at"}]', '4: the view has the status timeline');
select is(jsonb_array_length(current_setting('t.h')::jsonb -> 'disputes'), 1, '5: the dispute');
select ok((current_setting('t.h')::jsonb -> 'admin_actions') @> '[{"action":"dispute_investigating"}]',
          '6: and the admin decision on that dispute');
select tests.as_owner();
select is((select count(*)::int from public.admin_audit_log where action = 'job_evidence_viewed' and target_id = current_setting('t.job')::uuid), 1,
          '7: opening the view is itself logged');
select tests.login_as(current_setting('t.admin')::uuid);
select ok(jsonb_array_length(public.admin_job_history(current_setting('t.job')::uuid) -> 'viewed_by') >= 1, '8: and the view shows who opened it');
select tests.as_owner();
select is((select to_jsonb(j)::text from public.jobs j where id = current_setting('t.job')::uuid), current_setting('t.jobrow'),
          '9: viewing changes nothing on the job');

-- public tracking link
select set_config('t.tok', (select tracking_token::text from public.jobs where id = current_setting('t.job')::uuid), true);
select tests.as_anon();
select set_config('t.pub', coalesce(public.get_public_tracking(current_setting('t.tok')::uuid)::text, '{}'), true);
select ok(not (current_setting('t.pub') ~* '"(phone|email|customer_id|driver_id|pickup_photo_url|delivery_photo_url|national_id|license|delivery_pin|final_price|budget|payment)'),
          '10: the public tracking link has no contact details, ids, documents, photos, code or money');
select ok(current_setting('t.pub')::jsonb ? 'status', '11: it still shows the delivery status');

select * from finish();
rollback;
