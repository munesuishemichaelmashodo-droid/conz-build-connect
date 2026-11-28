-- 0185 (28/11 owner rules): customer referrals and driver referrals keep separate progress and milestones, awards
-- are idempotent, the old shared milestone table is no longer written, and a super admin can correct who invited a
-- NEW account through an audited function that can never recognise, move a counted referral or pay anything.
begin;
select plan(24);

select tests.as_owner();
select set_config('t.r',     tests.create_user('rp_inviter')::text, true);
select set_config('t.r2',    tests.create_user('rp_inviter2')::text, true);
select set_config('t.c1',    tests.create_user('rp_cust1')::text, true);
select set_config('t.d1',    tests.create_driver('rp_drv1', 40)::text, true);
select set_config('t.x',     tests.create_driver('rp_other_drv', 40)::text, true);
select set_config('t.y',     tests.create_user('rp_other_cust')::text, true);
select set_config('t.n',     tests.create_user('rp_new')::text, true);
select set_config('t.old',   tests.create_user('rp_old')::text, true);
select set_config('t.admin', tests.create_user('rp_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('rp_super', array['super_admin','admin'])::text, true);
update public.profiles set referral_code = 'RPINV1' where id = current_setting('t.r')::uuid;
update public.profiles set referral_code = 'RPINV2' where id = current_setting('t.r2')::uuid;
update public.profiles set referral_code = 'RPNEW1' where id = current_setting('t.n')::uuid;
update auth.users set created_at = now() - interval '40 days' where id = current_setting('t.old')::uuid;
select set_config('t.wtx', (select count(*)::text from public.wallet_transactions), true);

create function pg_temp.done_job(_cust uuid, _driver uuid) returns uuid language plpgsql as $$
declare _j uuid;
begin
  _j := tests.create_job(_cust, 200, 'direct');
  update public.jobs set status = 'completed', driver_id = _driver, final_price = 200, completed_at = now() where id = _j;
  return _j;
end $$;
create function pg_temp.run() returns void language plpgsql as $$
begin
  perform tests.as_owner();
  update public.referrals set reward_release_at = now() - interval '1 minute' where reward_status = 'hold';
  perform tests.as_service();
  perform public.process_referral_lifecycle();
  perform tests.as_owner();
end $$;

-- ============================================================ A. one inviter, two programmes
select tests.login_as(current_setting('t.c1')::uuid);
select lives_ok($$select public.record_referral('RPINV1', 'customer')$$, '1: a new customer joins with the invitation');
select tests.login_as(current_setting('t.d1')::uuid);
select lives_ok($$select public.record_referral('RPINV1', 'driver')$$, '2: a new driver joins with the same invitation');
select tests.as_owner();
select pg_temp.done_job(current_setting('t.c1')::uuid, current_setting('t.x')::uuid);           -- customer's first delivery
select pg_temp.done_job(current_setting('t.y')::uuid, current_setting('t.d1')::uuid) from generate_series(1, 4);
select pg_temp.run();
select pg_temp.run();
select is((select reward_status from public.referrals where referred_id = current_setting('t.c1')::uuid), 'released',
          '3: the customer referral counts after the first genuine delivery and the check');
select is((select reward_status from public.referrals where referred_id = current_setting('t.d1')::uuid), 'pending',
          '4: the driver referral does not count after four jobs (registration and verification are not enough)');
select is((select string_agg(programme || ':' || milestone, ',' order by programme, milestone) from public.referral_programme_milestones
            where user_id = current_setting('t.r')::uuid), 'customer:1', '5: only the customer programme has a milestone');
select pg_temp.done_job(current_setting('t.y')::uuid, current_setting('t.d1')::uuid);
select pg_temp.run();
select pg_temp.run();
select is((select reward_status from public.referrals where referred_id = current_setting('t.d1')::uuid), 'released',
          '6: the fifth genuine job qualifies the driver referral (then the check)');
select is((select string_agg(programme || ':' || milestone, ',' order by programme, milestone) from public.referral_programme_milestones
            where user_id = current_setting('t.r')::uuid), 'customer:1,driver:1',
          '7: the driver programme gets its own first milestone; the customer count is not added to it');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.r')::uuid and type = 'referral_milestone'), 2,
          '8: one milestone notice per programme, despite repeated runs');
select ok((select bool_and(title ~ '(customer|driver) referrals') from public.notifications
            where user_id = current_setting('t.r')::uuid and type = 'referral_milestone'), '9: each notice names its programme');
select is((select count(*)::int from public.referral_milestones_achieved where user_id = current_setting('t.r')::uuid), 0,
          '10: the old shared milestone table is no longer written');
select tests.login_as(current_setting('t.r')::uuid);
select is((select count(*)::int from public.referral_programme_milestones), 2, '11: the inviter reads their own milestones');
select throws_ok($$insert into public.referral_programme_milestones (user_id, programme, milestone) values (auth.uid(), 'driver', 50)$$,
                 '42501', null, '12: nobody can write a milestone directly');
select tests.login_as(current_setting('t.c1')::uuid);
select is((select count(*)::int from public.referral_programme_milestones), 0, '13: other people cannot read them');
select tests.as_owner();
select is((select count(*)::text from public.wallet_transactions), current_setting('t.wtx'), '14: no money moved anywhere');

-- ============================================================ B. audited attribution correction
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_set_referral_attribution(%L, 'RPINV2', 'Customer showed the WhatsApp invite')$$, current_setting('t.n')),
                 '42501', null, '15: a plain admin cannot correct a referral');
select tests.login_as(current_setting('t.super')::uuid);
select throws_ok(format($$select public.admin_set_referral_attribution(%L, 'RPINV2', 'Customer showed the WhatsApp invite')$$, current_setting('t.n')),
                 null, null, '16: a super admin needs a fresh step-up');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$select public.admin_set_referral_attribution(%L, 'RPNEW1', 'Customer showed the WhatsApp invite')$$, current_setting('t.n')),
                 '22023', null, '17: an account cannot be recorded as inviting itself');
select throws_ok(format($$select public.admin_set_referral_attribution(%L, 'RPINV2', 'Customer showed the WhatsApp invite')$$, current_setting('t.old')),
                 '22023', null, '18: an account that is not new cannot be attributed');
select throws_ok(format($$select public.admin_set_referral_attribution(%L, 'RPINV2', 'short')$$, current_setting('t.n')),
                 '22023', null, '19: a reason is required');
select lives_ok(format($$select public.admin_set_referral_attribution(%L, 'RPINV2', 'Customer showed the WhatsApp invite')$$, current_setting('t.n')),
                '20: a missed invitation is recorded');
select tests.as_owner();
select is((select referrer_id::text || ':' || reward_status from public.referrals where referred_id = current_setting('t.n')::uuid),
          current_setting('t.r2') || ':pending', '21: it starts at "pending": nothing is counted by the correction');
select ok(exists (select 1 from public.admin_audit_log where action = 'referral_attribution_set'), '22: the correction is in the audit log');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$select public.admin_set_referral_attribution(%L, 'RPINV2', 'Trying to move a counted referral')$$, current_setting('t.c1')),
                 '22023', null, '23: a counted referral cannot be moved (its account also already had a delivery)');
select tests.as_owner();
select is((select referrer_id from public.referrals where referred_id = current_setting('t.c1')::uuid), current_setting('t.r')::uuid,
          '24: the counted referral still belongs to the original inviter');

select * from finish();
rollback;
