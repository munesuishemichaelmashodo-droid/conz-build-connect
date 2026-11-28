-- 0181: no referral route can move money; admin review stays (with reasons, audit, no self-dealing);
-- clients cannot write referrals directly; legacy history is left exactly as it was.
begin;
select plan(20);

select tests.as_owner();
select set_config('t.ref',   tests.create_user('nc_ref')::text, true);
select set_config('t.cust',  tests.create_user('nc_cust')::text, true);
select set_config('t.cust2', tests.create_user('nc_cust2')::text, true);
select set_config('t.admin', tests.create_user('nc_admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('nc_super', array['super_admin','admin'])::text, true);
select set_config('t.drv',   tests.create_driver('nc_drv', 40)::text, true);

insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, reward_status, verification_status, reward_release_at)
values (current_setting('t.ref')::uuid, current_setting('t.cust')::uuid, 'NC1', 'customer', 'hold', 'verified', now() + interval '5 days')
returning set_config('t.r1', id::text, true);
-- a legacy row as the old engine left it (amount + an old note); must stay as it is
insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, reward_status, verification_status, reward_amount, admin_notes)
values (current_setting('t.drv')::uuid, current_setting('t.cust2')::uuid, 'NC2', 'customer', 'released', 'verified', 15, 'legacy')
returning set_config('t.legacy', id::text, true);
select set_config('t.legacy_before', (select row_to_json(r)::text from public.referrals r where id = current_setting('t.legacy')::uuid), true);

-- ============================================================ A. money is impossible
select throws_ok(format($$insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
                          values (%L, 'referral_bonus', 15, 55, 'x')$$, current_setting('t.drv')),
                 '42501', null, '1: even the owner role cannot write a referral wallet credit');
select tests.as_service();
select lives_ok($$select public.process_referral_lifecycle()$$, '2: the scheduled run works');
select tests.as_owner();
select is((select row_to_json(r)::text from public.referrals r where id = current_setting('t.legacy')::uuid), current_setting('t.legacy_before'),
          '3: legacy referral history is untouched by processing');

-- ============================================================ B. clients cannot write or run it directly
select tests.login_as(current_setting('t.ref')::uuid);
select throws_ok(format($$update public.referrals set reward_status = 'released' where id = %L$$, current_setting('t.r1')),
                 '42501', null, '4: a user cannot update their referral directly');
select throws_ok(format($$insert into public.referrals (referrer_id, referred_id, referral_code, referred_role) values (%L, %L, 'X', 'customer')$$,
                        current_setting('t.ref'), current_setting('t.cust2')),
                 '42501', null, '5: nor insert one');
select throws_ok(format($$delete from public.referrals where id = %L$$, current_setting('t.r1')), '42501', null, '6: nor delete one');
select throws_ok($$select public.process_referral_lifecycle()$$, '42501', null, '7: nor run the processing');
select is((select count(*)::int from public.referrals where id = current_setting('t.r1')::uuid), 1, '8: the referrer can read their own referral');
select tests.as_anon();
select throws_ok($$select count(*) from public.referrals$$, '42501', null, '9: signed-out visitors cannot read referrals');

-- ============================================================ C. admin review
select tests.login_as(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_referral_action(%L, 'freeze')$$, current_setting('t.r1')), '%reason%',
                   '10: freezing needs a reason');
select lives_ok(format($$select public.admin_referral_action(%L, 'freeze', 'same phone as another account')$$, current_setting('t.r1')),
                '11: an admin freezes with a reason');
select lives_ok(format($$select public.admin_referral_action(%L, 'unfreeze', 'checked: different people')$$, current_setting('t.r1')),
                '12: and unfreezes');
select is((select reward_status from public.referrals where id = current_setting('t.r1')::uuid), 'hold',
          '13: a qualified referral goes back to its hold after unfreezing');
select throws_ok(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r1')), '42501', null,
                 '14: an ordinary admin cannot recognise early');
select tests.login_as(current_setting('t.super')::uuid);
select throws_like(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r1')), 'MFA_REQUIRED%',
                   '15: a super admin needs a fresh step-up');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$select public.admin_referral_action(%L, 'release')$$, current_setting('t.r1')),
                '16: a super admin with step-up recognises it');
select lives_ok(format($$select public.admin_referral_action(%L, 'reject', 'duplicate account found later')$$, current_setting('t.r1')),
                '17: a recognised referral can be corrected with a reason');
select tests.as_owner();
select is((select count(*)::int from public.admin_audit_log where target_id = current_setting('t.r1')::uuid and action like 'referral_%'), 4,
          '18: every admin action is in the audit log');
select is((select count(*)::int from public.wallet_transactions where type = 'referral_bonus'), 0, '19: and none of it moved money');
select is(tests.balance(current_setting('t.ref')::uuid), 0.00::numeric, '20: the referrer''s balance is unchanged');

select * from finish();
rollback;
