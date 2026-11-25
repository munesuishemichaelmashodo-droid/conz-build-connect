-- 0176: a signed webhook whose server-to-server status check still says "pending" must NOT use up its event id,
-- so the provider's retry of the same event can apply the payment once the status reads paid. Also: the money is
-- recorded once whichever path (webhook or return-page status check) arrives first, the 7% is taken once from the
-- total agreed deal, and the driver's prepaid commission credit is never touched by a provider-paid job.
begin;
select plan(20);

select tests.as_owner();
select set_config('t.cust', tests.create_user('pr_customer')::text, true);
select set_config('t.drv',  tests.create_driver('pr_driver', 50)::text, true);
select set_config('t.drv2', tests.create_driver('pr_driver2', 0)::text, true);
update public.system_settings set value = '"linkwa"'::jsonb where key = 'payment_provider';

create function pg_temp.provider_job(_driver uuid, _price numeric) returns uuid language plpgsql as $f$
declare _job uuid; _bid uuid;
begin
  perform tests.as_owner();
  _job := tests.create_job(current_setting('t.cust')::uuid, _price, 'direct');
  update public.jobs set payment_method = 'provider' where id = _job;
  _bid := tests.create_bid(_job, _driver, _price);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_bid);
  perform tests.as_owner();
  return _job;
end $f$;
create function pg_temp.apply(_ev text, _pay uuid, _status text, _amount numeric, _pref text, _source text default 'webhook')
returns text language plpgsql as $f$
begin
  perform tests.as_service();
  return public.apply_provider_link_payment('linkwa', _ev, _pay, _status, _amount, case when _amount is null then null else 'USD' end,
                                            null, 'lnk-p', 'sh-pend', _pref, null, _source);
end $f$;
create function pg_temp.receipts(_pay uuid) returns int language sql as $f$
  select count(*)::int from public.platform_ledger where payment_id = _pay and account = 'provider_clearing' $f$;

-- $400 agreed deal (materials $300 + transport $100), paid through the provider.
select set_config('t.job', pg_temp.provider_job(current_setting('t.drv')::uuid, 400)::text, true);
select tests.as_service();
select set_config('t.pay', (public.create_provider_job_payment(current_setting('t.job')::uuid, 'linkwa', null)).id::text, true);
select public.provider_claim_payment_link(current_setting('t.pay')::uuid, 'linkwa');
select public.provider_record_payment_link(current_setting('t.pay')::uuid, 'linkwa', 'lnk-p', 'sh-pend', 'https://sandbox.example/pay/sh-pend');
select tests.as_owner();
select set_config('t.bal0', coalesce(tests.balance(current_setting('t.drv')::uuid), 0)::text, true);
select set_config('t.wtx0', (select count(*) from public.wallet_transactions where user_id = current_setting('t.drv')::uuid)::text, true);

-- ---------------------------------------------------------------- delayed status: the webhook must stay retryable
select is(pg_temp.apply('payment.completed:pr-p1', current_setting('t.pay')::uuid, 'pending', null, 'pr-p1'),
          'pending_no_change', '1: webhook arrives while the provider still says pending: nothing changes');
select tests.as_owner();
select is((select count(*)::int from public.provider_payment_events where event_id = 'payment.completed:pr-p1'), 0,
          '2: a pending answer does not use up the webhook''s event id');
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'initiated', '3: payment still open');
select is(pg_temp.receipts(current_setting('t.pay')::uuid), 0, '4: no ledger line for a pending payment');
select is(pg_temp.apply('payment.completed:pr-p1', current_setting('t.pay')::uuid, 'paid', 400, 'pr-p1'),
          'applied_paid', '5: the provider''s retry of the same event applies the payment once the status reads paid');
select tests.as_owner();
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'paid', '6: payment is paid');
select is(pg_temp.receipts(current_setting('t.pay')::uuid), 1, '7: exactly one receipt in the ledger');
select is((select payment_reference from public.provider_payment_refs where payment_id = current_setting('t.pay')::uuid), 'pr-p1',
          '8: the payment reference is stored once');

-- ---------------------------------------------------------------- duplicates on both paths: never a second credit
select is(pg_temp.apply('payment.completed:pr-p1', current_setting('t.pay')::uuid, 'paid', 400, 'pr-p1'),
          'duplicate', '9: a replayed webhook is a duplicate');
select is(pg_temp.apply('status:pr-p1:paid', current_setting('t.pay')::uuid, 'paid', 400, 'pr-p1', 'status_check'),
          'already_paid', '10: the customer''s return-page check after the webhook changes nothing');
select is(pg_temp.apply('status:pr-p1:paid', current_setting('t.pay')::uuid, 'paid', 400, 'pr-p1', 'status_check'),
          'duplicate', '11: repeating the return-page check is a duplicate');
select tests.as_owner();
select is(pg_temp.receipts(current_setting('t.pay')::uuid), 1, '12: still exactly one receipt');
select is((select sum(amount) from public.platform_ledger where payment_id = current_setting('t.pay')::uuid and account = 'provider_clearing'),
          400.00::numeric, '13: the receipt is the agreed $400');

-- ---------------------------------------------------------------- unrecognised words never count as paid
select set_config('t.job2', pg_temp.provider_job(current_setting('t.drv2')::uuid, 120)::text, true);
select tests.as_service();
select set_config('t.pay2', (public.create_provider_job_payment(current_setting('t.job2')::uuid, 'linkwa', null)).id::text, true);
select public.provider_claim_payment_link(current_setting('t.pay2')::uuid, 'linkwa');
select public.provider_record_payment_link(current_setting('t.pay2')::uuid, 'linkwa', 'lnk-q', 'sh-unrec', 'https://sandbox.example/pay/sh-unrec');
select is(public.apply_provider_link_payment('linkwa', 'status:pr-q:COMPLETED', current_setting('t.pay2')::uuid, 'unrecognised:COMPLETED',
                                              120, 'USD', null, 'lnk-q', 'sh-unrec', 'pr-q', null, 'status_check'),
          'unknown_status_flagged', '14: a status word the documentation does not map is flagged, not paid');
select tests.as_owner();
select is((select status from public.payments where id = current_setting('t.pay2')::uuid), 'initiated', '15: and the payment stays open');

-- ---------------------------------------------------------------- settlement: 7% of the whole deal, once; credit untouched
update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.job')::uuid);
select tests.as_owner();
select is((select commission || '/' || amount || '/' || gross_amount from public.driver_payables where job_id = current_setting('t.job')::uuid),
          '28.00/372.00/400.00', '16: $400 deal ($300 materials + $100 transport): ConZ $28, driver $372');
select is((select -sum(amount) from public.platform_ledger where payment_id = current_setting('t.pay')::uuid and account = 'platform_revenue'),
          28.00::numeric, '17: platform revenue is $28, posted once');
select is(coalesce(tests.balance(current_setting('t.drv')::uuid), 0), current_setting('t.bal0')::numeric,
          '18: the driver''s prepaid commission credit balance is unchanged');
select is((select count(*) from public.wallet_transactions where user_id = current_setting('t.drv')::uuid)::text, current_setting('t.wtx0'),
          '19: no commission-credit transaction was written for a provider-paid job');
select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'driver_payable_matches_payables', 'job_funds_match_paid_job_payments',
                                 'provider_jobs_never_use_commission_credit', 'provider_jobs_settled_once') and not ok), 0,
          '20: ledger and provider reconciliation checks pass');

select * from finish();
rollback;
