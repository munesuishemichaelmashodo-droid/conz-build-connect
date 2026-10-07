-- Phase 16 — schema-wide security invariants. These fail if any future
-- migration re-opens a class of hole closed by this hardening programme.

begin;
select plan(13);

-- 1. RLS on every public table
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  '{}'::text[], 'Every public table has row-level security enabled');

-- 2. anon can never write to money tables
select is(
  (select coalesce(array_agg(t || ':' || p order by t, p), '{}')
     from unnest(array['wallets','wallet_transactions','payments','payment_events','platform_ledger','escrow_refunds',
                       'admin_money_actions','admin_credit_requests','reconciliation_runs',
                       'wallet_withdrawal_requests','wallet_topup_requests','admin_audit_log']) t,
          unnest(array['INSERT','UPDATE','DELETE']) p
    where has_table_privilege('anon', 'public.' || t, p)),
  '{}'::text[], 'anon holds no write privilege on any money / audit table');

-- 3. Signed-in clients cannot write money / audit tables directly
select is(
  (select coalesce(array_agg(t || ':' || p order by t, p), '{}')
     from unnest(array['wallets','wallet_transactions','payment_events','platform_ledger','escrow_refunds',
                       'admin_money_actions','admin_credit_requests','reconciliation_runs','admin_audit_log']) t,
          unnest(array['INSERT','UPDATE','DELETE']) p
    where has_table_privilege('authenticated', 'public.' || t, p)),
  '{}'::text[], 'authenticated holds no direct write privilege on ledger / audit tables');

-- 4. Only the intended functions are callable anonymously
select is(
  (select coalesce(array_agg(distinct p.proname::text order by p.proname::text), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['compute_material_offer','get_public_tracking','has_role','public_material_pickups']::text[],
  'Anonymous EXECUTE is limited to the four public read helpers');

-- 5. Every SECURITY DEFINER function pins its search_path
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  '{}'::text[], 'Every SECURITY DEFINER function sets search_path');

-- 6. Money internals are server-only
select is(
  (select coalesce(array_agg(f order by f), '{}')
     from unnest(array[
       'credit_wallet_from_payment','mark_escrow_payment_paid','release_escrow_and_complete','apply_paynow_result',
       'post_ledger','admin_money_guard','admin_apply_wallet_change','escrow_mark_refund_due','escrow_refund_due_for_job',
       'anonymize_deleted_account','run_financial_reconciliation','create_price_quote_for','log_admin_action',
       'check_withdrawal_pin','hold_job_commission','release_job_commission','auto_release_escrow_payments',
       'expire_stale_accepted_jobs','paynow_pending_for_reconcile','expire_stale_paynow_payment','request_paynow_reconcile',
       'notify_payment_anomaly','record_payment_event']) f
    where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = f
                     and has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  '{}'::text[], 'Money / ledger / audit internals are not callable by signed-in clients');

-- 7. Append-only tables reject edits even from the owner role (rows must
--    exist: row-level triggers do not fire on an empty table).
select set_config('t.w', tests.create_user('ledgerrow')::text, true);
insert into public.wallet_transactions (user_id, type, amount, balance_after, note) values (current_setting('t.w')::uuid, 'topup', 1, 1, 'x');
select tests.as_service();
select public.post_ledger('test', '[{"account":"opening_balance","amount":1},{"account":"user_wallets","amount":-1}]'::jsonb);
insert into public.payments (user_id, type, amount, currency, method, status) values (current_setting('t.w')::uuid, 'topup', 1, 'USD', 'paynow', 'initiated')
  returning set_config('t.wp', id::text, true);
select public.record_payment_event(current_setting('t.wp')::uuid, 'initiate', 'test');
select tests.as_owner();
select throws_ok($$update public.wallet_transactions set amount = 2$$, null, null, 'wallet_transactions immutable');
select throws_ok($$delete from public.platform_ledger$$, '42501', null, 'platform_ledger append-only');
select throws_ok($$delete from public.payment_events$$, '42501', null, 'payment_events append-only');

-- 8. Large / overflow values
select set_config('t.u', tests.create_user('big')::text, true);
select throws_ok(format($$insert into public.payments (user_id, type, amount, currency, method, status) values (%L, 'topup', 100000.01, 'USD', 'paynow', 'initiated')$$,
                        current_setting('t.u')), '23514', null, 'Payments above $100,000 are rejected');
select throws_ok(format($$update public.wallets set balance = 10000000.01 where user_id = %L$$, current_setting('t.u')),
  '23514', null, 'Wallet balances above the platform ceiling are rejected');
select tests.login_as(current_setting('t.u')::uuid);
select throws_ok($$select public.request_topup(100001, 'ecocash', 'X')$$, null, null, 'Top-up requests above $100,000 are rejected');
select throws_ok($$select public.request_withdrawal(100001, 'ecocash', '0771234567', '0000')$$, null, null,
  'Withdrawals above $100,000 are rejected before any PIN check');

select * from finish();
rollback;
