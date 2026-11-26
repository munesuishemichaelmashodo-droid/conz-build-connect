-- 0184 (+0181 rule): dispute decisions only through audited functions; leftover grants closed; trust signals are
-- admin-only, read-only, privacy-preserving and logged; clearing a referral fraud flag needs a reason.
begin;
select plan(29);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select tests.as_owner();
select set_config('t.c1',  tests.create_user('st_cust1')::text, true);
select set_config('t.c2',  tests.create_user('st_cust2')::text, true);
select set_config('t.adm', tests.create_user('st_admin', array['admin'])::text, true);
select set_config('t.d1',  tests.create_driver('st_drv1', 0)::text, true);
select set_config('t.d2',  tests.create_driver('st_drv2', 0)::text, true);

create function pg_temp.done(_c uuid, _d uuid) returns uuid language plpgsql as $f$
declare _j uuid;
begin
  _j := tests.create_job(_c, 200, 'direct');
  update public.jobs set status = 'completed', driver_id = _d, final_price = 200, completed_at = now() where id = _j;
  return _j;
end $f$;
select set_config('t.j1', pg_temp.done(current_setting('t.c1')::uuid, current_setting('t.d1')::uuid)::text, true);
insert into public.disputes (job_id, raised_by, against, reason, category, status)
values (current_setting('t.j1')::uuid, current_setting('t.c1')::uuid, current_setting('t.d1')::uuid, 'Load was short by half', 'other', 'open')
returning set_config('t.disp', id::text, true);

-- ================================================================ A. disputes: no direct writes
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$update public.disputes set status = 'rejected' where id = %L$$, current_setting('t.disp')), '42501', null,
                 '1: an admin cannot close a dispute by editing the row');
select throws_ok(format($$delete from public.disputes where id = %L$$, current_setting('t.disp')), '42501', null,
                 '2: nor delete it');
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok(format($$update public.disputes set reason = 'changed' where id = %L$$, current_setting('t.disp')), '42501', null,
                 '3: the person who raised it cannot edit it either');
select tests.as_anon();
select throws_ok($$select count(*) from public.disputes$$, '42501', null, '4: signed-out visitors cannot read disputes');

-- ================================================================ B. disputes: audited actions
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok(format($$select public.admin_mark_dispute_investigating(%L)$$, current_setting('t.disp')), '42501', null,
                 '5: a customer cannot mark a dispute as investigating');
select tests.login_as(current_setting('t.adm')::uuid);
select lives_ok(format($$select public.admin_mark_dispute_investigating(%L)$$, current_setting('t.disp')), '6: an admin marks it investigating');
select throws_ok(format($$select public.admin_mark_dispute_investigating(%L)$$, current_setting('t.disp')), '22023', null,
                 '7: only from open');
select throws_ok(format($$select public.admin_reject_dispute(%L, 'no')$$, current_setting('t.disp')), '22023', null,
                 '8: rejecting needs a real reason');
select lives_ok(format($$select public.admin_reject_dispute(%L, 'Photos show the full load was delivered')$$, current_setting('t.disp')),
                '9: an admin rejects it with a reason');
select tests.as_owner();
select is((select row(status, resolved_by is not null, resolved_at is not null)::text from public.disputes where id = current_setting('t.disp')::uuid),
          '(rejected,t,t)', '10: status, who and when are recorded');
select is((select count(*)::int from public.admin_audit_log where target_id = current_setting('t.disp')::uuid
             and action in ('dispute_investigating', 'dispute_rejected')), 2, '11: both actions are in the audit log');
select is((select count(*)::int from public.notifications where type = 'dispute_resolved'
             and user_id in (current_setting('t.c1')::uuid, current_setting('t.d1')::uuid)), 2, '12: both parties are told');
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$select public.admin_reject_dispute(%L, 'second decision')$$, current_setting('t.disp')), '22023', null,
                 '13: a decided dispute cannot be decided again');

-- an admin who is a party cannot act
select tests.as_owner();
select set_config('t.jadm', pg_temp.done(current_setting('t.adm')::uuid, current_setting('t.d2')::uuid)::text, true);
insert into public.disputes (job_id, raised_by, against, reason, category, status)
values (current_setting('t.jadm')::uuid, current_setting('t.adm')::uuid, current_setting('t.d2')::uuid, 'Admin as a customer here', 'other', 'open')
returning set_config('t.disp2', id::text, true);
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok(format($$select public.admin_reject_dispute(%L, 'my own dispute')$$, current_setting('t.disp2')), '42501', null,
                 '14: an admin cannot decide their own dispute');

-- ================================================================ C. chat flags
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$delete from public.chat_flags$$, '42501', null, '15: users cannot delete chat flags');
select tests.as_anon();
select throws_ok($$select count(*) from public.chat_flags$$, '42501', null, '16: signed-out visitors cannot read chat flags');

-- ================================================================ D. trust signals
select tests.as_owner();
-- shared phone between a customer and a driver, who then complete 4 jobs together in 30 days
update public.profiles set phone = '+263 77 123 4567' where id = current_setting('t.c2')::uuid;
update public.profiles set phone = '0771234567' where id = current_setting('t.d2')::uuid;
select pg_temp.done(current_setting('t.c2')::uuid, current_setting('t.d2')::uuid) from generate_series(1, 4);
-- one payment reference on two jobs
select set_config('t.ja', pg_temp.done(current_setting('t.c1')::uuid, current_setting('t.d1')::uuid)::text, true);
select set_config('t.jb', pg_temp.done(current_setting('t.c1')::uuid, current_setting('t.d1')::uuid)::text, true);
alter table public.direct_payment_stages disable trigger user;
insert into public.direct_payment_stages (job_id, stage, expected_amount, customer_claimed_at, customer_amount, customer_reference)
values (current_setting('t.ja')::uuid, 'full', 200, now(), 200, 'MP26ABC'), (current_setting('t.jb')::uuid, 'full', 200, now(), 200, 'mp26abc ');
alter table public.direct_payment_stages enable trigger user;
-- a flagged referral
insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, fraud_flag, fraud_reason)
values (current_setting('t.d1')::uuid, current_setting('t.c2')::uuid, 'ST1', 'customer', true, 'same phone as the referrer')
returning set_config('t.ref', id::text, true);
select set_config('t.status_before', (select string_agg(id::text || coalesce(status::text, ''), ',' order by id) from public.profiles), true);

select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$select * from public.admin_trust_signals()$$, '42501', null, '17: a customer cannot see trust signals');
select tests.login_as(current_setting('t.d1')::uuid);
select throws_ok($$select * from public.admin_trust_signals()$$, '42501', null, '18: nor a driver');
select tests.as_anon();
select throws_ok($$select * from public.admin_trust_signals()$$, '42501', null, '19: nor a signed-out visitor');

select tests.login_as(current_setting('t.adm')::uuid);
create temp table _sig as select * from public.admin_trust_signals();
select ok(exists(select 1 from _sig where signal = 'shared_phone' and current_setting('t.c2')::uuid = any(user_ids)
                 and current_setting('t.d2')::uuid = any(user_ids)), '20: two accounts with the same number are listed');
select ok(exists(select 1 from _sig where signal = 'shared_phone' and detail like '%ending 567%'), '21: the number is shown as its last 3 digits');
select ok(not exists(select 1 from _sig where detail ~ '77 ?123|771234|4567'), '22: never the full number');
select is((select count(*)::int from _sig where signal = 'customer_driver_same_phone'), 4, '23: each completed job between them is listed');
select is((select seen from _sig where signal = 'repeated_pair_30_days' and current_setting('t.c2')::uuid = any(user_ids)), 4,
          '24: 4 jobs between the same pair in 30 days are listed');
select ok(not exists(select 1 from _sig where signal = 'repeated_pair_30_days' and current_setting('t.c1')::uuid = any(user_ids)),
          '25: 3 jobs between another pair are not (below the threshold)');
select is((select seen from _sig where signal = 'payment_reference_reused'), 2, '26: one payment reference on two jobs is listed');
select ok(exists(select 1 from _sig where signal = 'flagged_referral'), '27: a flagged referral is listed');

select tests.as_owner();
select is((select string_agg(id::text || coalesce(status::text, ''), ',' order by id) from public.profiles), current_setting('t.status_before'),
          '28: no account was changed by the signals (no automatic suspension)');

-- ================================================================ E. clearing a referral fraud flag needs a reason
select tests.login_as(current_setting('t.adm')::uuid);
select throws_like(format($$select public.admin_referral_action(%L, 'approve')$$, current_setting('t.ref')), '%reason%',
                   '29: clearing a fraud flag without a reason is refused');

select * from finish();
rollback;
