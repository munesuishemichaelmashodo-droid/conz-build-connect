-- 0094 — manual payout tracking. Approval debits the wallet; "paid" exists only when an
-- admin records the transfer reference. Nothing here moves money.

begin;
select plan(22);
select tests.enable_launch_features();

select set_config('t.drv',   tests.create_driver('pt_drv', 100)::text, true);
select set_config('t.other', tests.create_driver('pt_other', 100)::text, true);
select set_config('t.admin', tests.create_user('pt_admin', array['admin'])::text, true);
select set_config('t.admin2',tests.create_user('pt_admin2', array['admin'])::text, true);
select set_config('t.super', tests.create_user('pt_super', array['super_admin','admin'])::text, true);
select set_config('t.plain', tests.create_user('pt_plain')::text, true);

create or replace function pg_temp.wd(_k text) returns public.wallet_withdrawal_requests language sql as $$
  select * from public.wallet_withdrawal_requests where id = current_setting(_k)::uuid $$;

-- A pending, an approved, and a rejected withdrawal
select tests.login_as(current_setting('t.drv')::uuid);
select public.set_withdrawal_pin('4826', null);
select public.request_withdrawal(10, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.pending', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status = 'pending'), true);
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select public.admin_reject_withdrawal(current_setting('t.pending')::uuid, 'testing a rejected request');
select tests.as_owner();
select set_config('t.rejected', current_setting('t.pending'), true);

select tests.login_as(current_setting('t.drv')::uuid);
select public.request_withdrawal(40, 'ecocash', '0771234567', '4826');
select tests.as_owner();
select set_config('t.appr', (select id::text from public.wallet_withdrawal_requests where user_id = current_setting('t.drv')::uuid and status = 'pending'), true);

-- Pending cannot be marked paid
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-TEST-1')$$, current_setting('t.appr')),
  '%Only an approved withdrawal%', 'A pending withdrawal cannot be marked paid');
select public.admin_approve_withdrawal(current_setting('t.appr')::uuid);
select tests.as_owner();
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 60::numeric, 'setup: approval debited 40 once');
select ok((select paid_at is null from public.wallet_withdrawal_requests where id = current_setting('t.appr')::uuid), 'Approved is NOT paid: paid_at is null');
select ok((select body not ilike '%withdrawn from your wallet%' and body ilike '%by hand%' from public.notifications
            where user_id = current_setting('t.drv')::uuid and title like 'Withdrawal approved%' order by created_at desc limit 1),
  'Approval notification says payout is pending/manual, not that money was sent');

-- Rejected cannot be marked paid
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-TEST-1')$$, current_setting('t.rejected')),
  '%Only an approved withdrawal%', 'A rejected withdrawal cannot be marked paid');

-- Permissions
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-TEST-1')$$, current_setting('t.appr')), '%Forbidden%', 'The driver cannot mark their own payout paid');
select tests.login_as(current_setting('t.plain')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-TEST-1')$$, current_setting('t.appr')), '%Forbidden%', 'A non-admin cannot mark a payout paid');
select tests.as_anon();
select throws_ok(format($$select public.admin_mark_withdrawal_paid(%L, 'EC-TEST-1')$$, current_setting('t.appr')), '42501', null, 'Anonymous callers cannot execute it');

-- Direct client writes cannot record a payout: RLS gives no update path to an approved row
-- (zero rows), and the guard trigger refuses payout fields on any row the owner can still touch.
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$update public.wallet_withdrawal_requests set paid_at = now(), paid_by = %L, payout_reference = 'FAKE-REF' where id = %L$$,
  current_setting('t.drv'), current_setting('t.appr')), 'A driver update of an approved row is a no-op under RLS');
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select lives_ok(format($$update public.wallet_withdrawal_requests set paid_at = now(), paid_by = %L, payout_reference = 'FAKE-REF' where id = %L$$,
  current_setting('t.admin'), current_setting('t.appr')), 'An admin session has no direct update path either');
select tests.login_as(current_setting('t.other')::uuid);
select public.set_withdrawal_pin('4826', null);
select public.request_withdrawal(10, 'ecocash', '0771234567', '4826');
select throws_ok(format($$update public.wallet_withdrawal_requests set status = 'cancelled', paid_at = now(), paid_by = %L, payout_reference = 'FAKE-REF' where user_id = %L and status = 'pending'$$,
  current_setting('t.other'), current_setting('t.other')), '42501', null, 'The guard trigger refuses payout fields on a pending row the owner can update');

-- Validation
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, 'x')$$, current_setting('t.appr')), '%transfer reference%', 'A tiny reference is refused');
select throws_like(format($$select public.admin_mark_withdrawal_paid(%L, NULL)$$, current_setting('t.appr')), '%transfer reference%', 'A missing reference is refused');
select tests.as_owner();
select ok((select paid_at is null from public.wallet_withdrawal_requests where id = current_setting('t.appr')::uuid), 'Refused attempts left the withdrawal unpaid');

-- Success path + idempotency
select tests.login_as_mfa(current_setting('t.admin2')::uuid);
select lives_ok(format($$select public.admin_mark_withdrawal_paid(%L, '  EC-TEST-REF-1  ', 'paid from business EcoCash')$$, current_setting('t.appr')), 'An admin records the payout');
select tests.as_owner();
select is((select payout_reference from public.wallet_withdrawal_requests where id = current_setting('t.appr')::uuid), 'EC-TEST-REF-1', 'Reference stored trimmed');
select set_config('t.paid_at', (select paid_at::text from public.wallet_withdrawal_requests where id = current_setting('t.appr')::uuid), true);
select tests.login_as_mfa(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_mark_withdrawal_paid(%L, 'OTHER-REF-2')$$, current_setting('t.appr')), 'A second call is accepted as a no-op (idempotent)');
select tests.as_owner();
select is((select payout_reference || '|' || paid_at::text from public.wallet_withdrawal_requests where id = current_setting('t.appr')::uuid),
  'EC-TEST-REF-1|' || current_setting('t.paid_at'), 'The first confirmation wins; reference and time unchanged');
select is((select count(*)::int from public.admin_audit_log where action = 'withdrawal_payout_recorded' and target_id = current_setting('t.appr')::uuid), 1, 'Exactly one audit entry for the payout');
select is((select balance from public.wallets where user_id = current_setting('t.drv')::uuid), 60::numeric, 'Recording a payout moves no money (balance still 60)');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and type = 'withdrawal'), 1, 'Still exactly one withdrawal transaction');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.drv')::uuid and title = 'Payout recorded as sent'), 1, 'The driver was notified exactly once');

select * from finish();
rollback;
