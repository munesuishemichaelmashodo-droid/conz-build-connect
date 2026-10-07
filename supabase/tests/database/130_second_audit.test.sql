-- Phase 19 — regressions for issues found by the second security audit.

begin;
select plan(16);

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 0)::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('super', array['super_admin','admin'])::text, true);

-- 1. Reconciliation output is not readable by ordinary users
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select * from public.financial_reconciliation()$$, '42501', null,
  'Audit-2: users cannot read platform money totals / reconciliation details');
select throws_ok($$select * from public.admin_reconciliation_report()$$, '42501', null, 'Audit-2: nor through the admin report');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok($$select * from public.admin_reconciliation_report()$$, '42501', null, 'Ordinary admins cannot either');
select tests.login_as(current_setting('t.super')::uuid);
select lives_ok($$select * from public.admin_reconciliation_report()$$, 'Super admins can read the report');

-- 2. Direct-pay dispute refund is a wallet credit: super_admin + MFA
select tests.as_owner();
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
update public.jobs set status = 'completed', driver_id = current_setting('t.drv')::uuid, final_price = 400, commission = 28
 where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.d', (public.raise_dispute(current_setting('t.job')::uuid, null, 'other', 'Short delivery, wanted refund')).id::text, true);

select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.resolve_dispute(%L, 'refund', 'refund commission')$$, current_setting('t.d')),
  '42501', null, 'Audit-2: an ordinary admin can no longer credit a wallet via a dispute refund');
select tests.login_as(current_setting('t.super')::uuid);
select throws_like(format($$select public.resolve_dispute(%L, 'refund', 'refund commission')$$, current_setting('t.d')),
  'MFA_REQUIRED%', 'Super admin needs MFA for the refund credit');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$select public.resolve_dispute(%L, 'refund', 'refund commission')$$, current_setting('t.d')),
  'Super admin with MFA can refund the commission');
select tests.as_owner();
select is(tests.balance(current_setting('t.cust')::uuid), 28.00::numeric, 'Customer credited exactly the commission');
select ok(exists(select 1 from public.admin_money_actions where kind = 'dispute_refund' and amount = 28),
  'Refund counted against the super admin''s daily credit cap');

-- 3. Referral rewards: no self-dealing, no releasing frozen/rejected, release = credit gate
select tests.as_owner();
insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, reward_status, reward_amount)
values (current_setting('t.admin')::uuid, current_setting('t.cust')::uuid, 'ADM1', 'customer', 'approved', 15)
returning set_config('t.r_self', id::text, true);
insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, reward_status, reward_amount, fraud_flag)
values (current_setting('t.drv')::uuid, tests.create_user('frozenref'), 'DRV1', 'customer', 'frozen', 15, true)
returning set_config('t.r_frozen', id::text, true);
select set_config('t.other', tests.create_user('other')::text, true);
insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, reward_status, reward_amount)
values (current_setting('t.drv')::uuid, current_setting('t.other')::uuid, 'DRV2', 'customer', 'approved', 15)
returning set_config('t.r_ok', id::text, true);

select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r_self')), '42501', null,
  'Audit-2: an admin cannot release their own referral reward');
select throws_ok(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r_ok')), '42501', null,
  'Audit-2: an ordinary admin cannot release (credit) a referral reward');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_like(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r_frozen')), 'Only an approved, unflagged reward%',
  'Audit-2: a fraud-frozen reward cannot be released');
select lives_ok(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r_ok')),
  'Super admin with MFA can release a legitimate approved reward');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 15.00::numeric, 'Referrer credited once');

-- 4. Commission rate changes need MFA
select tests.login_as(current_setting('t.super')::uuid);
select throws_like($$select public.admin_set_commission(10, 'raise commission')$$, 'MFA_REQUIRED%', 'Commission change without MFA refused');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok($$select public.admin_set_commission(7, 'keep at seven percent')$$, 'Commission change with MFA works');

select * from finish();
rollback;
