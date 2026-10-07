-- Phase 6 / audit F5 (+ F8 forged audit entries) — admin money controls:
-- ordinary admins debit-only within a daily cap, super_admin credits need
-- MFA, a daily cap and a second super_admin above the threshold, no self
-- targeting, reversals once only, append-only audit trail.
-- Defaults: admin debit cap $500/day, super_admin credit cap $500/day,
-- second-approval threshold $100.

begin;
select plan(45);

select set_config('t.user',  tests.create_user('user')::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);
select set_config('t.s1',    tests.create_user('super1', array['super_admin','admin'])::text, true);
select set_config('t.s2',    tests.create_user('super2', array['super_admin','admin'])::text, true);

-- user starts with $1,000 (with a matching ledger row)
update public.wallets set balance = 1000 where user_id = current_setting('t.user')::uuid;
insert into public.wallet_transactions (user_id, type, amount, balance_after, note)
values (current_setting('t.user')::uuid, 'topup', 1000, 1000, 'opening balance');

-- ---------------------------------------------------------------------------
-- Ordinary users
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.user')::uuid);
select throws_ok(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'free money please')$$, current_setting('t.user')),
  '42501', null, 'A normal user cannot adjust wallets');
select throws_ok($$select public.log_admin_action('fake_action', '{}'::jsonb, 'forged', null, null)$$,
  '42501', null, 'F8: a normal user can no longer write forged audit entries');
select throws_ok($$insert into public.admin_audit_log (actor_id, action) values (auth.uid(), 'forged')$$,
  '42501', null, 'F8: direct insert into the audit log is denied');

-- ---------------------------------------------------------------------------
-- Ordinary admin: debit-only, not self, daily cap
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'goodwill credit')$$, current_setting('t.user')),
  '42501', null, 'F5: an ordinary admin cannot credit a wallet (cannot create money)');
select throws_ok(format($$select public.admin_wallet_adjust(%L, -10, 'other', 'self debit test')$$, current_setting('t.admin')),
  '42501', null, 'F5: an ordinary admin cannot target their own wallet');
select lives_ok(format($$select public.admin_wallet_adjust(%L, -100, 'payment_correction', 'duplicate topup correction')$$, current_setting('t.user')),
  'Ordinary admin can debit within the cap');
select lives_ok(format($$select public.admin_wallet_adjust(%L, -400, 'payment_correction', 'second correction today')$$, current_setting('t.user')),
  'Second debit brings the admin to the $500 daily cap');
select throws_ok(format($$select public.admin_wallet_adjust(%L, -1, 'payment_correction', 'one dollar over the cap')$$, current_setting('t.user')),
  '42501', null, 'F5: daily debit cap cannot be bypassed by repeated calls');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 500.00::numeric, 'User debited exactly $500');

-- ---------------------------------------------------------------------------
-- Super admin credits: MFA, self, threshold, cap
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.s1')::uuid);
select throws_like(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'credit without mfa')$$, current_setting('t.user')),
  'MFA_REQUIRED%', 'F5: super_admin credit without MFA is refused');
select tests.login_as_mfa(current_setting('t.s1')::uuid);
select throws_ok(format($$select public.admin_wallet_adjust(%L, 50, 'other', 'credit to myself')$$, current_setting('t.s1')),
  '42501', null, 'F5: super_admin cannot credit their own wallet');
select throws_like(format($$select public.admin_wallet_adjust(%L, 150, 'other', 'large credit attempt')$$, current_setting('t.user')),
  'SECOND_APPROVAL_REQUIRED%', 'F5: credits over $100 need a second super admin');
select lives_ok(format($$select public.admin_wallet_adjust(%L, 100, 'refund', 'refund for failed delivery')$$, current_setting('t.user')),
  'Super admin with MFA credits $100');
select lives_ok(format($$select public.admin_wallet_adjust(%L, 100, 'refund', 'refund number two')$$, current_setting('t.user')), 'credit 2');
select lives_ok(format($$select public.admin_wallet_adjust(%L, 100, 'refund', 'refund number three')$$, current_setting('t.user')), 'credit 3');
select lives_ok(format($$select public.admin_wallet_adjust(%L, 100, 'refund', 'refund number four')$$, current_setting('t.user')), 'credit 4');
select lives_ok(format($$select public.admin_wallet_adjust(%L, 100, 'refund', 'refund number five')$$, current_setting('t.user')),
  'Fifth $100 credit reaches the $500 daily credit cap');
select throws_ok(format($$select public.admin_wallet_adjust(%L, 1, 'refund', 'one dollar too many')$$, current_setting('t.user')),
  '42501', null, 'F5: super_admin daily credit cap cannot be bypassed by splitting into small credits');
select throws_like(format($$select public.admin_credit_wallet(%L, 'NaN', 'legacy path')$$, current_setting('t.user')),
  '%Amount%', 'Legacy admin_credit_wallet goes through the same gate');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 1000.00::numeric, 'User credited exactly $500');

-- ---------------------------------------------------------------------------
-- Two-person credit above the threshold
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.s1')::uuid);
select throws_like(format($$select public.admin_request_wallet_credit(%L, 1000, 'dispute_resolution', 'large goodwill credit')$$, current_setting('t.user')),
  'MFA_REQUIRED%', 'Credit request needs MFA');
select tests.login_as_mfa(current_setting('t.s1')::uuid);
select set_config('t.req', (public.admin_request_wallet_credit(current_setting('t.user')::uuid, 1000, 'dispute_resolution', 'large goodwill credit')).id::text, true);
select is((select status from public.admin_credit_requests where id = current_setting('t.req')::uuid), 'pending', 'Request is pending');
select throws_ok(format($$select public.admin_decide_wallet_credit(%L, true)$$, current_setting('t.req')),
  '42501', null, 'F5: the requester cannot approve their own credit request');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_decide_wallet_credit(%L, true)$$, current_setting('t.req')),
  '42501', null, 'An ordinary admin cannot approve credit requests');
select tests.login_as(current_setting('t.s2')::uuid);
select throws_like(format($$select public.admin_decide_wallet_credit(%L, true)$$, current_setting('t.req')),
  'MFA_REQUIRED%', 'Second super admin needs MFA to approve');
select tests.login_as_mfa(current_setting('t.s2')::uuid);
select lives_ok(format($$select public.admin_decide_wallet_credit(%L, true, 'checked the dispute')$$, current_setting('t.req')),
  'Second super admin with MFA approves');
select throws_ok(format($$select public.admin_decide_wallet_credit(%L, true)$$, current_setting('t.req')),
  null, null, 'An approved request cannot be applied twice');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 2000.00::numeric, 'Approved $1,000 credited exactly once');

-- Requests that target the approver
select tests.login_as_mfa(current_setting('t.s1')::uuid);
select set_config('t.req2', (public.admin_request_wallet_credit(current_setting('t.s2')::uuid, 500, 'other', 'credit for super two')).id::text, true);
select tests.login_as_mfa(current_setting('t.s2')::uuid);
select throws_ok(format($$select public.admin_decide_wallet_credit(%L, true)$$, current_setting('t.req2')),
  '42501', null, 'F5: a super admin cannot approve a credit to their own wallet');
select throws_ok(format($$select public.admin_request_wallet_credit(%L, 500, 'other', 'credit for myself')$$, current_setting('t.s2')),
  '42501', null, 'F5: a super admin cannot request a credit to their own wallet');
select tests.login_as_mfa(current_setting('t.s1')::uuid);
select set_config('t.req3', (public.admin_request_wallet_credit(current_setting('t.user')::uuid, 300, 'other', 'to be rejected')).id::text, true);
select tests.login_as_mfa(current_setting('t.s2')::uuid);
select lives_ok(format($$select public.admin_decide_wallet_credit(%L, false, 'not justified')$$, current_setting('t.req3')), 'Request can be rejected');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 2000.00::numeric, 'Rejected request credits nothing');

-- ---------------------------------------------------------------------------
-- Reversals
-- ---------------------------------------------------------------------------
select set_config('t.debit_tx', (select id::text from public.wallet_transactions
  where user_id = current_setting('t.user')::uuid and amount = -100 and type = 'adjustment' limit 1), true);
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_wallet_reverse(%L, 'not my call')$$, current_setting('t.debit_tx')),
  null, null, 'Ordinary admins cannot reverse');
select tests.login_as(current_setting('t.s2')::uuid);
select throws_like(format($$select public.admin_wallet_reverse(%L, 'reverse without mfa')$$, current_setting('t.debit_tx')),
  'MFA_REQUIRED%', 'Reversal (a credit) needs MFA');
select tests.login_as_mfa(current_setting('t.s2')::uuid);
select lives_ok(format($$select public.admin_wallet_reverse(%L, 'debit was a mistake')$$, current_setting('t.debit_tx')),
  'Super admin with MFA reverses the $100 debit');
select throws_ok(format($$select public.admin_wallet_reverse(%L, 'reverse again')$$, current_setting('t.debit_tx')),
  null, null, 'A transaction can only be reversed once');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 2100.00::numeric, 'Reversal restored exactly $100');

-- ---------------------------------------------------------------------------
-- Settings, audit trail, ledger
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok($$select public.admin_set_money_controls('{"admin_debit_daily_cap":100000}', 'raise my cap')$$,
  '42501', null, 'Ordinary admins cannot change the money controls');
select tests.login_as_mfa(current_setting('t.s1')::uuid);
select throws_ok($$select public.admin_set_money_controls('{"admin_debit_daily_cap":"NaN","super_admin_debit_daily_cap":500,"super_admin_credit_daily_cap":500,"second_approval_threshold":100}', 'bad value')$$,
  null, null, 'Money controls reject NaN');
select lives_ok($$select public.admin_set_money_controls('{"admin_debit_daily_cap":300,"super_admin_debit_daily_cap":500,"super_admin_credit_daily_cap":500,"second_approval_threshold":100}', 'tighten admin cap')$$,
  'Super admin with MFA can tune the controls');

select tests.as_owner();
select ok((select count(*) from public.admin_audit_log where action in ('wallet_debited_by_admin','wallet_credited_by_admin','wallet_credit_approved','wallet_transaction_reversed')) >= 9,
  'Every money action was written to the audit log');
select throws_ok($$delete from public.admin_audit_log$$, '42501', null, 'F8: audit log is append-only (even for the owner role)');
select throws_ok($$update public.admin_audit_log set reason = 'edited'$$, '42501', null, 'F8: audit entries cannot be edited');
select is((select count(*)::int from (select entry_group from public.platform_ledger group by entry_group having sum(amount) <> 0) x), 0,
  'Ledger: every admin money entry balances');
select ok(tests.ledger_matches(current_setting('t.user')::uuid), 'Ledger invariant: user wallet = sum of its transactions');

select * from finish();
rollback;
