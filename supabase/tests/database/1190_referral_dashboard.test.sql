-- 0185: who can be invited, what counts, recognition that is withdrawn when a referral is rejected,
-- the private progress list, share counting, admin metrics; and still no money anywhere.
begin;
select plan(42);

select tests.as_owner();
select set_config('t.ref',   tests.create_user('rd_ref')::text, true);              -- customer who invites
select set_config('t.rdrv',  tests.create_driver('rd_rdrv', 50)::text, true);      -- driver who invites
select set_config('t.new',   tests.create_user('rd_new')::text, true);              -- brand-new customer
select set_config('t.new2',  tests.create_user('rd_new2')::text, true);
select set_config('t.old',   tests.create_user('rd_old')::text, true);              -- account from last month
select set_config('t.used',  tests.create_user('rd_used')::text, true);             -- new, but already had a delivery
select set_config('t.nd',    tests.create_driver('rd_nd', 40)::text, true);          -- new driver
select set_config('t.other', tests.create_driver('rd_other', 40)::text, true);       -- some other driver
select set_config('t.admin', tests.create_user('rd_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('rd_super', array['super_admin','admin'])::text, true);
update auth.users set created_at = now() - interval '40 days' where id = current_setting('t.old')::uuid;
update public.profiles set referral_code = 'RDREF1' where id = current_setting('t.ref')::uuid;
update public.profiles set referral_code = 'RDDRV1' where id = current_setting('t.rdrv')::uuid;

create function pg_temp.done_job(_cust uuid, _driver uuid) returns uuid language plpgsql as $$
declare _j uuid;
begin
  _j := tests.create_job(_cust, 200, 'direct');
  update public.jobs set status = 'completed', driver_id = _driver, final_price = 200, completed_at = now() where id = _j;
  return _j;
end $$;
select pg_temp.done_job(current_setting('t.used')::uuid, current_setting('t.other')::uuid);
select set_config('t.wallets_before',
  (select string_agg(user_id::text || ':' || balance::text, ',' order by user_id) from public.wallets), true);
select set_config('t.wtx_before', (select count(*)::text from public.wallet_transactions), true);

-- ============================================================ A. attribution
select tests.as_anon();
select throws_ok($$select public.record_referral('RDREF1', 'customer')$$, '42501', null, '1: signed-out visitors cannot claim a code');
select tests.login_as(current_setting('t.old')::uuid);
select throws_like($$select public.record_referral('RDREF1', 'customer')$$, '%new account%', '2: an account older than 14 days cannot be attributed');
select tests.login_as(current_setting('t.used')::uuid);
select throws_like($$select public.record_referral('RDREF1', 'customer')$$, '%new account%', '3: nor an account that already had a delivery');
select tests.login_as(current_setting('t.ref')::uuid);
select throws_ok($$select public.record_referral('RDREF1', 'customer')$$, 'P0001', 'You cannot refer yourself', '4: nobody can invite themselves');
select tests.login_as(current_setting('t.new')::uuid);
select throws_ok($$select public.record_referral('NOPE99', 'customer')$$, 'P0001', 'Referral code not found', '5: an unknown code is refused');
select lives_ok($$select public.record_referral(' rddrv1 ', 'customer')$$, '6: a new customer claims a code (case and spaces ignored)');
select throws_ok($$select public.record_referral('RDREF1', 'customer')$$, 'P0001', 'This account has already redeemed a referral code',
                 '7: one attribution per account');
select tests.login_as(current_setting('t.nd')::uuid);
select lives_ok($$select public.record_referral('RDREF1', 'driver')$$, '8: a new driver claims a customer''s code');
select tests.as_owner();
select is((select count(*)::int from public.referrals where referred_id = current_setting('t.new')::uuid), 1, '9: exactly one referral row for the customer');
select ok(not exists(select 1 from public.notifications where type = 'referral_joined' and body ~* '(\$|earn|bonus|reward|credit)'),
          '10: the joined notice promises nothing');

-- ============================================================ B. what counts
-- a delivery by the person who invited them does not count
select pg_temp.done_job(current_setting('t.new')::uuid, current_setting('t.rdrv')::uuid);
select tests.as_service();
select public.process_referral_lifecycle();
select tests.as_owner();
select is((select verification_status from public.referrals where referred_id = current_setting('t.new')::uuid), 'pending',
          '11: a delivery from a related account does not qualify the customer');
-- a delivery under an open dispute does not count either
select set_config('t.dj', pg_temp.done_job(current_setting('t.new')::uuid, current_setting('t.other')::uuid)::text, true);
insert into public.disputes (job_id, raised_by, against, reason, status)
values (current_setting('t.dj')::uuid, current_setting('t.new')::uuid, current_setting('t.other')::uuid, 'short load', 'open');
select tests.as_service();
select public.process_referral_lifecycle();
select tests.as_owner();
select is((select verification_status from public.referrals where referred_id = current_setting('t.new')::uuid), 'pending',
          '12: a delivery under an open dispute does not qualify');
update public.disputes set status = 'rejected', resolution = 'no merit', resolved_at = now() where job_id = current_setting('t.dj')::uuid;
select tests.as_service();
select public.process_referral_lifecycle();
select tests.as_owner();
select is((select reward_status from public.referrals where referred_id = current_setting('t.new')::uuid), 'hold',
          '13: once the dispute is closed the first genuine delivery qualifies (then a check period)');

-- driver: four genuine jobs plus one for the inviter is not enough
select pg_temp.done_job(current_setting('t.new2')::uuid, current_setting('t.nd')::uuid) from generate_series(1, 4);
select pg_temp.done_job(current_setting('t.ref')::uuid, current_setting('t.nd')::uuid);
select tests.as_service();
select public.process_referral_lifecycle();
select tests.as_owner();
select is((select verification_status from public.referrals where referred_id = current_setting('t.nd')::uuid), 'pending',
          '14: a job for the person who invited them does not count towards the five');
select pg_temp.done_job(current_setting('t.new2')::uuid, current_setting('t.nd')::uuid);
select tests.as_service();
select public.process_referral_lifecycle();
select tests.as_owner();
select is((select reward_status from public.referrals where referred_id = current_setting('t.nd')::uuid), 'hold',
          '15: verified plus five genuine jobs qualifies the driver');

-- ============================================================ C. progress is private
select tests.login_as(current_setting('t.rdrv')::uuid);
select is((select count(*)::int from public.my_referral_progress()), 1, '16: the inviter sees their one invitation');
select is((select stage from public.my_referral_progress()), 'qualified', '17: stage = qualified during the check period');
select is((select jobs_done || '/' || jobs_needed from public.my_referral_progress()), '1/1', '18: customer progress is 1 of 1');
select ok((select ref_key from public.my_referral_progress()) not in (select id::text from public.referrals)
          and (select ref_key from public.my_referral_progress()) <> current_setting('t.new'),
          '19: the list key is neither the referral id nor the invited person''s id');
select ok(not exists (
  select 1 from unnest(array['ref_key','invited_as','joined_month','stage','verified','jobs_done','jobs_needed','recognised_on']) c
   where c ~ '(name|phone|email|referred_id|user_id)'), '20: the progress columns carry no name, phone, e-mail or id');
select is((select extract(day from joined_month)::int from public.my_referral_progress()), 1, '21: only the month joined is shown');
select tests.login_as(current_setting('t.new')::uuid);
select is((select count(*)::int from public.my_referral_progress()), 0, '22: the invited person does not see the inviter''s list');
select tests.login_as(current_setting('t.ref')::uuid);
select is((select jobs_done || '/' || jobs_needed || ' ' || verified::text from public.my_referral_progress()), '5/5 true',
          '23: the inviting driver sees verification and job count only');
select tests.as_anon();
select throws_ok($$select * from public.my_referral_progress()$$, '42501', null, '24: visitors cannot call it');

-- ============================================================ D. recognition, idempotent, withdrawn on rejection
select tests.as_owner();
update public.referrals set reward_release_at = now() - interval '1 minute' where referrer_id = current_setting('t.rdrv')::uuid;
select tests.as_service();
select public.process_referral_lifecycle();
select public.process_referral_lifecycle();
select tests.as_owner();
select is((select reward_status from public.referrals where referrer_id = current_setting('t.rdrv')::uuid), 'released', '25: recognised after the check');
select is((select count(*)::int from public.referral_milestones_achieved where user_id = current_setting('t.rdrv')::uuid and milestone = 1 and revoked_at is null), 1,
          '26: the first milestone is earned once');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.rdrv')::uuid and type = 'referral_milestone'), 1,
          '27: two runs give one milestone notice');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_referral_action(%L, 'reject')$$,
                          (select id from public.referrals where referrer_id = current_setting('t.rdrv')::uuid)), '%reason%',
                   '28: withdrawing recognition needs a reason');
select lives_ok(format($$select public.admin_referral_action(%L, 'reject', 'Same person as the inviter, confirmed')$$,
                       (select id from public.referrals where referrer_id = current_setting('t.rdrv')::uuid)),
                '29: an admin rejects a recognised referral after finding fraud');
select tests.as_owner();
select ok((select revoked_at is not null and revoked_reason is not null from public.referral_milestones_achieved
            where user_id = current_setting('t.rdrv')::uuid and milestone = 1), '30: the milestone is marked withdrawn, with a reason');
select is((select count(*)::int from public.referral_milestones_achieved where user_id = current_setting('t.rdrv')::uuid), 1,
          '31: and is kept, not deleted');
select is((select count(*)::int from public.admin_audit_log where action = 'referral_reject'), 1, '32: the decision is in the audit log');
select tests.login_as(current_setting('t.rdrv')::uuid);
select is((select stage from public.my_referral_progress()), 'not_recognised', '33: the inviter sees it was not recognised');
select throws_ok($$update public.referral_milestones_achieved set revoked_at = null$$, '42501', null, '34: nobody can un-withdraw a milestone directly');

-- ============================================================ E. shares
select tests.login_as(current_setting('t.ref')::uuid);
select ok(public.record_referral_share('whatsapp'), '35: a share is counted');
select throws_like($$select public.record_referral_share('sms_blast')$$, '%Unknown share channel%', '36: unknown channels are refused');
select throws_ok(format($$insert into public.referral_share_events (user_id, channel) values (%L, 'copy_link')$$, current_setting('t.ref')),
                 '42501', null, '37: share events cannot be written directly');
select tests.as_owner();
insert into public.referral_share_events (user_id, channel) select current_setting('t.ref')::uuid, 'copy_link' from generate_series(1, 29);
select tests.login_as(current_setting('t.ref')::uuid);
select is(public.record_referral_share('copy_code'), false, '38: after 30 in a day shares stop being counted (never blocked)');

-- ============================================================ F. metrics and money
select throws_ok($$select public.admin_referral_metrics()$$, '42501', null, '39: only admins see referral metrics');
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select m ? 'shares' and m ? 'signups' and m ? 'retention' and m ? 'areas' and (m->'signups'->>'drivers')::int = 1
             and (m->>'drivers_five_jobs')::int = 1 and (m->'review'->>'rejected')::int = 1 and (m->'partner_benefits'->>'cost')::int = 0
           from public.admin_referral_metrics() m), '40: admin metrics count sign-ups, qualification, rejections; no benefit cost');
select tests.as_owner();
select is((select string_agg(user_id::text || ':' || balance::text, ',' order by user_id) from public.wallets),
          current_setting('t.wallets_before'), '41: no wallet balance changed');
select is((select count(*)::text from public.wallet_transactions), current_setting('t.wtx_before'), '42: no wallet entry was written');

select * from finish();
rollback;
