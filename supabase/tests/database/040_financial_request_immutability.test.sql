-- Phase 5 / audit F4 — submitted withdrawal and top-up requests cannot be
-- tampered with; only the owner's cancel and the admin RPCs change them.

begin;
select plan(27);

select set_config('t.drv',   tests.create_driver('wd', 100)::text, true);
select set_config('t.other', tests.create_user('other')::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);
select set_config('t.super', tests.create_user('super', array['super_admin','admin'])::text, true);

-- Driver sets a PIN and submits a PIN-verified withdrawal.
select tests.login_as(current_setting('t.drv')::uuid);
select public.set_withdrawal_pin('4826', null);
select set_config('t.wd', public.request_withdrawal(50, 'ecocash', '0771234567', '4826')->'request'->>'id', true);

-- ---------------------------------------------------------------------------
-- The attack: change the payout after the PIN check
-- ---------------------------------------------------------------------------
select throws_ok(format($$update public.wallet_withdrawal_requests set destination = '0779999999' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: withdrawal destination cannot be changed after submission');
select throws_ok(format($$update public.wallet_withdrawal_requests set amount = 95 where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: withdrawal amount cannot be changed');
select throws_ok(format($$update public.wallet_withdrawal_requests set method = 'bank' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: withdrawal method cannot be changed');
select throws_ok(format($$update public.wallet_withdrawal_requests set note = 'x' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: withdrawal note cannot be changed');
select throws_ok(format($$update public.wallet_withdrawal_requests set status = 'approved' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: owner cannot approve their own request');
select throws_ok(format($$update public.wallet_withdrawal_requests set decided_by = auth.uid(), status = 'cancelled' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: owner cannot set decision fields');
select tests.as_owner();
select is((select destination from public.wallet_withdrawal_requests where id = current_setting('t.wd')::uuid), '0771234567',
  'F4: destination is still the PIN-authorised one');

-- Another user cannot touch it at all (RLS: 0 rows).
select tests.login_as(current_setting('t.other')::uuid);
update public.wallet_withdrawal_requests set status = 'cancelled' where id = current_setting('t.wd')::uuid;
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wd')::uuid), 'pending',
  'F4: another user cannot cancel someone else''s request');

-- Admins cannot approve by writing the table (would skip the debit).
select tests.login_as(current_setting('t.admin')::uuid);
update public.wallet_withdrawal_requests set status = 'approved' where id = current_setting('t.wd')::uuid;
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wd')::uuid), 'pending',
  'F4: admin direct-table approval no longer possible (no UPDATE policy)');
select is(tests.balance(current_setting('t.drv')::uuid), 100.00::numeric, 'F4: balance untouched');

-- Even service_role cannot rewrite a request.
select tests.as_service();
select throws_ok(format($$update public.wallet_withdrawal_requests set destination = '0770000000' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: destination immutable for service_role too');

-- ---------------------------------------------------------------------------
-- Legitimate paths still work
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.admin_approve_withdrawal(%L)$$, current_setting('t.wd')), 'Admin approves through the RPC');
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wd')::uuid), 'approved', 'Request approved');
select is(tests.balance(current_setting('t.drv')::uuid), 50.00::numeric, 'Wallet debited exactly the authorised $50');
select tests.as_service();
select throws_ok(format($$update public.wallet_withdrawal_requests set status = 'pending' where id = %L$$, current_setting('t.wd')),
  '42501', null, 'F4: a decided request is final');

-- Owner cancel (direct and via RPC)
select tests.login_as(current_setting('t.drv')::uuid);
select set_config('t.wd2', public.request_withdrawal(10, 'ecocash', '0771234567', '4826')->'request'->>'id', true);
select lives_ok(format($$update public.wallet_withdrawal_requests set status = 'cancelled' where id = %L$$, current_setting('t.wd2')),
  'Owner can cancel their own pending withdrawal');
-- RLS only exposes the owner's *pending* rows for UPDATE, so this matches
-- nothing; the guard trigger blocks it for privileged roles (tested above).
update public.wallet_withdrawal_requests set status = 'pending' where id = current_setting('t.wd2')::uuid;
select tests.as_owner();
select is((select status from public.wallet_withdrawal_requests where id = current_setting('t.wd2')::uuid), 'cancelled',
  'A cancelled request cannot be revived by its owner');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$delete from public.wallet_withdrawal_requests where id = %L$$, current_setting('t.wd2')),
  '42501', null, 'Clients cannot delete requests');

-- ---------------------------------------------------------------------------
-- Manual top-up requests
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.other')::uuid);
select set_config('t.tu', (public.request_topup(20, 'ecocash', 'MP241007.1234')).id::text, true);
select throws_ok(format($$update public.wallet_topup_requests set amount = 2000 where id = %L$$, current_setting('t.tu')),
  '42501', null, 'F4: top-up amount cannot be changed after submission');
select throws_ok(format($$update public.wallet_topup_requests set reference = 'MP-OTHER' where id = %L$$, current_setting('t.tu')),
  '42501', null, 'F4: top-up reference (proof) cannot be changed');
select throws_ok(format($$update public.wallet_topup_requests set status = 'approved' where id = %L$$, current_setting('t.tu')),
  '42501', null, 'F4: owner cannot approve their own top-up');

select tests.login_as(current_setting('t.super')::uuid);
update public.wallet_topup_requests set status = 'approved' where id = current_setting('t.tu')::uuid;
select tests.as_owner();
select is((select status from public.wallet_topup_requests where id = current_setting('t.tu')::uuid), 'pending',
  'F4: super_admin direct-table approval no longer possible');
select is(tests.balance(current_setting('t.other')::uuid), 0.00::numeric, 'No credit without the RPC');

select tests.login_as_mfa(current_setting('t.super')::uuid);
select lives_ok(format($$select public.admin_approve_topup(%L)$$, current_setting('t.tu')), 'Top-up approved through the RPC');
select tests.as_owner();
select is(tests.balance(current_setting('t.other')::uuid), 20.00::numeric, 'Credited exactly the submitted $20');
select ok(tests.ledger_matches(current_setting('t.other')::uuid), 'Ledger invariant holds after approval');

select tests.login_as(current_setting('t.other')::uuid);
select set_config('t.tu2', (public.request_topup(5, 'ecocash', 'MP241007.9999')).id::text, true);
select lives_ok(format($$select public.cancel_topup(%L)$$, current_setting('t.tu2')), 'Owner can cancel a pending top-up via RPC');

select * from finish();
rollback;
