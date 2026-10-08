-- Phase 14 — account deletion: refused while money/work is in flight;
-- personal data removed; financial and audit records retained.

begin;
select plan(18);

select set_config('t.drv',  tests.create_driver('leaver', 0)::text, true);
select set_config('t.cust', tests.create_user('cust')::text, true);
update public.profiles set phone = '+263771234567', email = 'leaver@test.local' where id = current_setting('t.drv')::uuid;
update public.driver_profiles set national_id = '63-111111A11', national_id_url = current_setting('t.drv') || '/id.jpg',
       zinara_url = current_setting('t.drv') || '/zinara.jpg', git_insurance_url = current_setting('t.drv') || '/git.pdf'
 where user_id = current_setting('t.drv')::uuid;
insert into public.device_tokens (user_id, platform, token) values (current_setting('t.drv')::uuid, 'android', 'fcm-token');
insert into storage.objects (bucket_id, name, owner) values ('driver-docs', current_setting('t.drv') || '/id.jpg', current_setting('t.drv')::uuid);

-- ---------------------------------------------------------------------------
-- Blockers
-- ---------------------------------------------------------------------------
update public.wallets set balance = 25 where user_id = current_setting('t.drv')::uuid;
select tests.as_service();
select ok('wallet_balance_positive' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)),
  'A positive wallet balance blocks deletion (withdraw first)');
select throws_like(format($$select public.anonymize_deleted_account(%L)$$, current_setting('t.drv')), 'ACCOUNT_DELETION_BLOCKED%',
  'Deletion is refused while money is in the wallet');
select tests.as_owner();
update public.wallets set balance = -5 where user_id = current_setting('t.drv')::uuid;
select tests.as_service();
select ok('wallet_balance_owed' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)),
  'An owed (negative) balance blocks deletion');
select tests.as_owner();
update public.wallets set balance = 0 where user_id = current_setting('t.drv')::uuid;

select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid)::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 400 where id = current_setting('t.job')::uuid;
select tests.as_service();
select ok('active_jobs' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)), 'An active job blocks deletion');
select tests.as_owner();
update public.jobs set status = 'completed' where id = current_setting('t.job')::uuid;

insert into public.payments (user_id, type, amount, currency, method, status)
values (current_setting('t.drv')::uuid, 'topup', 10, 'USD', 'paynow', 'initiated');
select tests.as_service();
select ok('payment_in_progress' = any(public.account_deletion_blockers(current_setting('t.drv')::uuid)), 'A payment in flight blocks deletion');
select tests.as_owner();
update public.payments set status = 'failed' where user_id = current_setting('t.drv')::uuid;

select tests.login_as(current_setting('t.drv')::uuid);
select is(public.account_deletion_blockers(auth.uid()), '{}'::text[], 'User can check their own blockers (none left)');
select throws_ok(format($$select public.anonymize_deleted_account(%L)$$, current_setting('t.cust')), '42501', null,
  'Clients cannot anonymize anyone directly');

-- Ledger rows that must survive
select tests.as_owner();
insert into public.wallet_transactions (user_id, type, amount, balance_after, note) values (current_setting('t.drv')::uuid, 'topup', 10, 10, 'old');
insert into public.wallet_transactions (user_id, type, amount, balance_after, note) values (current_setting('t.drv')::uuid, 'withdrawal', -10, 0, 'old');

-- ---------------------------------------------------------------------------
-- Delete
-- ---------------------------------------------------------------------------
select tests.as_service();
select set_config('t.res', public.anonymize_deleted_account(current_setting('t.drv')::uuid)::text, true);
select ok((current_setting('t.res')::jsonb -> 'driver_docs') ? (current_setting('t.drv') || '/id.jpg'),
  'Returns the KYC files the server must delete');
select tests.as_owner();
select is((select full_name from public.profiles where id = current_setting('t.drv')::uuid), 'Deleted user', 'Name removed');
select ok((select phone is null and email is null and deleted_at is not null and status = 'banned' from public.profiles where id = current_setting('t.drv')::uuid),
  'Contact details removed, account banned');
select ok((select national_id is null and national_id_url is null and zinara_url is null and git_insurance_url is null
                  and withdrawal_pin_hash is null and verification_status = 'rejected'
             from public.driver_profiles where user_id = current_setting('t.drv')::uuid),
  'All KYC fields cleared (incl. the previously missed compliance documents) and driver de-verified');
select is((select count(*)::int from public.device_tokens where user_id = current_setting('t.drv')::uuid), 0, 'Push tokens removed');
select is((select count(*)::int from public.user_roles where user_id = current_setting('t.drv')::uuid), 0, 'All roles removed');
select ok((select registration like 'DELETED-%' from public.trucks where driver_id = current_setting('t.drv')::uuid), 'Truck plate anonymised');
select is((select count(*)::int from public.wallet_transactions where user_id = current_setting('t.drv')::uuid), 2,
  'Financial ledger retained for reconciliation');
select ok(exists(select 1 from public.wallets where user_id = current_setting('t.drv')::uuid), 'Wallet row retained');
select ok(exists(select 1 from public.jobs where id = current_setting('t.job')::uuid and driver_id = current_setting('t.drv')::uuid),
  'Counterparty job history retained');
select ok(exists(select 1 from public.wallet_audit_log where user_id = current_setting('t.drv')::uuid and action = 'account_deleted'),
  'Deletion recorded in the audit log');

select * from finish();
rollback;
