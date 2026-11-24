-- 0175: payment-link identifiers kept apart (link id, short URL, payment reference, receipt id); each result bound to
-- the link ConZ recorded; duplicates, mismatches, unrecognised statuses, second payments and reuse refused; the 7%
-- commission on the total agreed deal unchanged; nobody but the server can write or call any of it.
begin;
select plan(52);

select tests.as_owner();
select set_config('t.cust', tests.create_user('lk_customer')::text, true);
select set_config('t.drv',  tests.create_driver('lk_driver', 0)::text, true);
select set_config('t.drv2', tests.create_driver('lk_driver2', 0)::text, true);
select set_config('t.adm',  tests.create_user('lk_admin', array['admin'])::text, true);
update public.system_settings set value = '"linkwa"'::jsonb where key = 'payment_provider';

-- A $400 job (materials $300 + transport $100) paid through the provider.
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
create function pg_temp.pstatus(_pay uuid) returns text language sql as $f$ select status from public.payments where id = _pay $f$;
create function pg_temp.apply(_ev text, _pay uuid, _status text, _amount numeric, _cur text, _booking text,
                              _link text, _url text, _pref text, _rcpt text) returns text language plpgsql as $f$
begin
  perform tests.as_service();
  return public.apply_provider_link_payment('linkwa', _ev, _pay, _status, _amount, _cur, _booking, _link, _url, _pref, _rcpt, 'webhook');
end $f$;

select set_config('t.job', pg_temp.provider_job(current_setting('t.drv')::uuid, 400)::text, true);
select tests.as_service();
select set_config('t.pay', (public.create_provider_job_payment(current_setting('t.job')::uuid, 'linkwa', null)).id::text, true);

-- ---------------------------------------------------------------- creating the link: claimed once, recorded once
select is(public.provider_claim_payment_link(current_setting('t.pay')::uuid, 'linkwa'), 'claimed', '1: first request claims the link');
select is(public.provider_claim_payment_link(current_setting('t.pay')::uuid, 'linkwa'), 'in_progress', '2: a second request waits (no second link)');
select throws_like($$select public.provider_claim_payment_link(current_setting('t.pay')::uuid, 'otherpay')$$,
                   '%not found for this provider%', '3: another provider cannot claim it');
select throws_like($$select public.provider_record_payment_link(current_setting('t.pay')::uuid, 'linkwa', 'lnk-1', 'sh-abc', 'http://insecure/pay/sh-abc')$$,
                   '%are required%', '4: link id, short URL and an https checkout URL are all required');
select lives_ok($$select public.provider_record_payment_link(current_setting('t.pay')::uuid, 'linkwa', 'lnk-1', 'sh-abc', 'https://sandbox.example/pay/sh-abc')$$,
                '5: link recorded');
select lives_ok($$select public.provider_record_payment_link(current_setting('t.pay')::uuid, 'linkwa', 'lnk-1', 'sh-abc', 'https://sandbox.example/pay/sh-abc')$$,
                '6: recording the same link again changes nothing');
select throws_like($$select public.provider_record_payment_link(current_setting('t.pay')::uuid, 'linkwa', 'lnk-2', 'sh-xyz', 'https://sandbox.example/pay/sh-xyz')$$,
                   '%different payment link%', '7: a payment has exactly one link');
select is(public.provider_claim_payment_link(current_setting('t.pay')::uuid, 'linkwa'), 'exists', '8: once recorded, the link is reused');
select is((select provider_reference from public.payments where id = current_setting('t.pay')::uuid), null,
          '9: payments.provider_reference is not used for link identifiers');

-- ---------------------------------------------------------------- who can see or call it
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.provider_payment_refs), 0, '10: the customer cannot read link records');
select throws_ok($$select public.apply_provider_link_payment('linkwa', 'x', null, 'paid', 400, 'USD', null, null, 'sh-abc', 'p', null, 'webhook')$$,
                 '42501', null, '11: a signed-in user cannot apply a payment');
select throws_ok($$select public.provider_claim_payment_link(current_setting('t.pay')::uuid, 'linkwa')$$, '42501', null,
                 '12: a signed-in user cannot claim a link');
select throws_ok($$select public.provider_record_payment_link(current_setting('t.pay')::uuid, 'linkwa', 'a', 'b', 'https://x.example/pay/b')$$, '42501', null,
                 '13: a signed-in user cannot record a link');
select throws_ok($$update public.provider_payment_refs set short_url = 'evil'$$, '42501', null, '14: a signed-in user cannot write link records');
select tests.login_as(current_setting('t.adm')::uuid);
select is((select count(*)::int from public.provider_payment_refs), 1, '15: an admin can read link records');

-- ---------------------------------------------------------------- mismatches: nothing applied
select is(pg_temp.apply('e1', current_setting('t.pay')::uuid, 'paid', 400, 'USD', null, 'lnk-1', 'sh-OTHER', 'pr-1', 'rc-1'),
          'rejected_link', '16: a result for a different link is refused');
select is(pg_temp.apply('e2', current_setting('t.pay')::uuid, 'paid', 400, 'USD', null, 'lnk-9', 'sh-abc', 'pr-1', 'rc-1'),
          'rejected_link', '17: a different link id is refused');
select is(pg_temp.apply('e3', current_setting('t.pay')::uuid, 'paid', 400, 'USD', gen_random_uuid()::text, 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'),
          'rejected_booking_reference', '18: a booking reference that is not this payment is refused');
select is(pg_temp.apply('e4', current_setting('t.pay')::uuid, 'paid', 399.99, 'USD', null, 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'),
          'rejected_amount', '19: the wrong amount is refused');
select is(pg_temp.apply('e5', current_setting('t.pay')::uuid, 'paid', 400, 'ZWG', null, 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'),
          'rejected_currency', '20: the wrong currency is refused');
select is(pg_temp.apply('e6', current_setting('t.pay')::uuid, 'paid', 400, 'USD', null, 'lnk-1', 'sh-abc', null, 'rc-1'),
          'rejected_payment_reference', '21: a paid result must name its payment reference');
select is(pg_temp.apply('e7', current_setting('t.pay')::uuid, 'COMPLETED', 400, 'USD', null, 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'),
          'unknown_status_flagged', '22: a raw provider word (COMPLETED) is never treated as paid');
select is(pg_temp.apply('e8', current_setting('t.pay')::uuid, 'pending', null, null, null, 'lnk-1', 'sh-abc', null, null),
          'pending_no_change', '23: pending changes nothing');
select is(pg_temp.apply('e9', null, 'paid', 400, 'USD', null, null, 'sh-nowhere', 'pr-x', null),
          'rejected_unknown_link', '24: a payment on a link ConZ never created is refused and admins are told');
select tests.as_owner();
select is(pg_temp.pstatus(current_setting('t.pay')::uuid), 'initiated', '25: after all of that the payment is still unpaid');
select is((select payment_reference from public.provider_payment_refs where payment_id = current_setting('t.pay')::uuid), null,
          '26: and no payment reference was stored');
select is((select count(*)::int from public.platform_ledger where payment_id = current_setting('t.pay')::uuid), 0, '27: and no ledger line');
select ok(exists (select 1 from public.notifications where type = 'payment_anomaly' and body like '%sh-nowhere%'),
          '28: the unknown-link payment raised an admin alert');

-- ---------------------------------------------------------------- success, found by its link
select is(pg_temp.apply('e10', null, 'paid', 400, 'USD', current_setting('t.pay'), 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'),
          'applied_paid', '29: a verified paid result on the right link is applied (payment found by its short URL)');
select tests.as_owner();
select is(pg_temp.pstatus(current_setting('t.pay')::uuid), 'paid', '30: the payment is paid');
select is((select row(external_payment_link_id, short_url, payment_reference, receipt_id)::text
             from public.provider_payment_refs where payment_id = current_setting('t.pay')::uuid),
          '(lnk-1,sh-abc,pr-1,rc-1)', '31: all four identifiers are stored separately');
select is((select sum(amount) from public.platform_ledger where payment_id = current_setting('t.pay')::uuid and account = 'provider_clearing'),
          400.00::numeric, '32: $400 recorded as received at the provider');

-- ---------------------------------------------------------------- replays and second payments
select is(pg_temp.apply('e10', null, 'paid', 400, 'USD', null, 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'), 'duplicate', '33: the same event twice is a duplicate');
select is(pg_temp.apply('e11', current_setting('t.pay')::uuid, 'paid', 400, 'USD', null, 'lnk-1', 'sh-abc', 'pr-1', 'rc-1'),
          'already_paid', '34: the same payment reported again changes nothing');
select is(pg_temp.apply('e12', current_setting('t.pay')::uuid, 'paid', 400, 'USD', null, 'lnk-1', 'sh-abc', 'pr-2', 'rc-2'),
          'second_payment_flagged', '35: a second payment on the same link is not applied and is flagged');
select is(pg_temp.apply('e13', current_setting('t.pay')::uuid, 'failed', null, null, null, 'lnk-1', 'sh-abc', 'pr-3', null) || '/' ||
          (select status from public.payments where id = current_setting('t.pay')::uuid),
          'attempt_failed/paid', '36: a late failed attempt is recorded and never undoes a confirmed payment');
select tests.as_owner();
select is((select sum(amount) from public.platform_ledger where payment_id = current_setting('t.pay')::uuid and account = 'provider_clearing'),
          400.00::numeric, '37: still exactly one $400 receipt in the ledger');
select ok(exists (select 1 from public.notifications where type = 'payment_anomaly' and title = 'Second payment on the same payment link'),
          '38: admins are told to refund the second payment');
select throws_ok($$update public.provider_payment_refs set receipt_id = 'other' where payment_id = current_setting('t.pay')::uuid$$,
                 '42501', null, '39: stored identifiers cannot be changed, even by the owner');
select throws_ok($$delete from public.provider_payment_refs where payment_id = current_setting('t.pay')::uuid$$,
                 '42501', null, '40: link records are never deleted');

-- ---------------------------------------------------------------- failed, cancelled, expired attempts; retry on the same link; reuse
select set_config('t.job2', pg_temp.provider_job(current_setting('t.drv2')::uuid, 250)::text, true);
select tests.as_service();
select set_config('t.ok', (public.create_provider_job_payment(current_setting('t.job2')::uuid, 'linkwa', null)).id::text, true);
select public.provider_claim_payment_link(current_setting('t.ok')::uuid, 'linkwa');
select public.provider_record_payment_link(current_setting('t.ok')::uuid, 'linkwa', 'lnk-ok', 'sh-ok', 'https://sandbox.example/pay/sh-ok');
select is(pg_temp.apply('e20', current_setting('t.ok')::uuid, 'failed', null, null, null, 'lnk-ok', 'sh-ok', 'pa-1', null), 'attempt_failed',
          '41: a failed attempt (e.g. insufficient funds) is recorded');
select is(pg_temp.apply('e21', current_setting('t.ok')::uuid, 'cancelled', null, null, null, 'lnk-ok', 'sh-ok', 'pa-2', null), 'attempt_cancelled',
          '42: a cancelled attempt is recorded');
select is(pg_temp.apply('e22', current_setting('t.ok')::uuid, 'expired', null, null, null, 'lnk-ok', 'sh-ok', 'pa-3', null), 'attempt_expired',
          '43: an expired attempt is recorded');
select tests.as_owner();
select is(pg_temp.pstatus(current_setting('t.ok')::uuid), 'initiated', '44: the payment stays open so the customer can try again on the same link');
select is(pg_temp.apply('e23', current_setting('t.ok')::uuid, 'paid', 250, 'USD', null, 'lnk-ok', 'sh-ok', 'pr-1', 'rc-9'),
          'rejected_payment_reference', '45: a payment reference already used by another payment is refused');
select is(pg_temp.apply('e24', current_setting('t.ok')::uuid, 'paid', 250, 'USD', null, 'lnk-ok', 'sh-ok', 'pr-9', 'rc-1'),
          'rejected_receipt_reuse', '46: a receipt already used by another payment is refused');
select is(pg_temp.apply('e25', current_setting('t.ok')::uuid, 'paid', 250, 'USD', null, 'lnk-ok', 'sh-abc', 'pr-9', 'rc-9'),
          'rejected_link', '47: another payment''s link is refused');
select is(pg_temp.apply('e26', current_setting('t.ok')::uuid, 'paid', 250, 'USD', null, 'lnk-ok', 'sh-ok', 'pr-9', 'rc-9'),
          'applied_paid', '48: a later successful attempt on the same link is applied');

-- ---------------------------------------------------------------- commission unchanged: 7% of the total agreed deal
select tests.as_owner();
update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.job')::uuid);
select tests.as_owner();
select is((select commission || '/' || amount from public.driver_payables where job_id = current_setting('t.job')::uuid),
          '28.00/372.00', '49: $400 deal: ConZ $28 (7%), driver $372');
select is((select held from public.wallets where user_id = current_setting('t.drv')::uuid), 0::numeric,
          '50: the driver''s commission credit was never touched');
select is((select count(*)::int from public.driver_payouts), 0, '51: no payout was created');
select is((select count(*)::int from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'driver_payable_matches_payables', 'job_funds_match_paid_job_payments',
                                 'provider_refunds_match_payments', 'provider_jobs_never_use_commission_credit',
                                 'provider_jobs_settled_once', 'payouts_match_payables') and not ok), 0,
          '52: ledger and provider reconciliation checks pass');

select * from finish();
rollback;
