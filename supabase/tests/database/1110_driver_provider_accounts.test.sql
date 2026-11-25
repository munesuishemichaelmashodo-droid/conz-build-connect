-- 0177: drivers' provider (Linkwa sub-merchant) accounts: written only by the server or admins, identifiers
-- write-once, new receiving accounts start unverified, no full account numbers, history append-only, and with
-- marketplace settlement switched on a provider-paid job is only given to a driver whose account is ready.
begin;
select plan(24);

select tests.as_owner();
update public.system_settings set value = '"linkwa"'::jsonb where key = 'payment_provider';
select set_config('t.cust', tests.create_user('pa_cust')::text, true);
select set_config('t.drv',  tests.create_driver('pa_drv', 0)::text, true);
select set_config('t.drv2', tests.create_driver('pa_drv2', 0)::text, true);
select set_config('t.adm',  tests.create_user('pa_adm', array['admin'])::text, true);

-- ---------------------------------------------------------------- who can write
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok($$select public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', 'SM-1', 'approved', 'ecocash', 'ecocash ••7707', true)$$,
                 '42501', null, '1: a driver cannot approve their own account');
select throws_ok($$insert into public.driver_provider_accounts (driver_id, provider, kyc_status) values (current_setting('t.drv')::uuid, 'linkwa', 'approved')$$,
                 '42501', null, '2: nor write the table directly');
select tests.as_anon();
select throws_ok($$select public.driver_provider_account_ready(current_setting('t.drv')::uuid)$$, '42501', null, '3: visitors cannot query readiness');

-- ---------------------------------------------------------------- what the provider reports
select tests.as_service();
select is((public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', null, 'submitted')).kyc_status, 'submitted',
          '4: submitted');
select throws_like($$select public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', null, 'approved')$$,
                   '%needs the provider''s account identifier%', '5: approval without the provider''s identifier is refused');
select throws_like($$select public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', 'SM-1', 'live')$$,
                   '%Unknown KYC status%', '6: an unknown status is refused');
select throws_ok($$select public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', 'SM-1', 'pending_review', 'ecocash', 'ecocash 0788687707')$$,
                 '23514', null, '7: a full account number is never stored (masked only)');
select is((public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', 'SM-1', 'approved', 'ecocash', 'ecocash ••7707', true)).kyc_status,
          'approved', '8: approved with identifier and a verified receiving account');
select is(public.driver_provider_account_ready(current_setting('t.drv')::uuid), true, '9: the driver is ready');
select throws_like($$select public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', 'SM-2', 'approved')$$,
                   '%different linkwa account%', '10: the provider identifier is write-once');
select is((public.provider_record_driver_account(current_setting('t.drv2')::uuid, 'linkwa', 'SM-9', 'approved', 'smilecash', 'smilecash ••1111', false)).receiving_account_verified_at,
          null, '11: an unverified receiving account stays unverified');
select is(public.driver_provider_account_ready(current_setting('t.drv2')::uuid), false, '12: so that driver is not ready');
select throws_ok($$select public.provider_record_driver_account(current_setting('t.drv2')::uuid, 'linkwa', 'SM-9x', 'submitted')$$, 'P0001', null,
                 '13: (identifier change refused)');
select is((public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', null, 'approved', 'bank', 'bank ••4321', false)).receiving_account_verified_at,
          null, '14: changing the receiving account makes it unverified again');
select is(public.driver_provider_account_ready(current_setting('t.drv')::uuid), false, '15: until the provider verifies the new account');
select public.provider_record_driver_account(current_setting('t.drv')::uuid, 'linkwa', null, 'approved', 'bank', 'bank ••4321', true);
select is(public.driver_provider_account_ready(current_setting('t.drv')::uuid), true, '16: ready again once verified');

-- ---------------------------------------------------------------- who can read
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.driver_provider_accounts), 1, '17: a driver sees only their own account');
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.driver_provider_accounts), 0, '18: a customer sees none');

-- ---------------------------------------------------------------- admin suspend, history
select tests.login_as(current_setting('t.adm')::uuid);
select throws_ok($$select public.admin_set_driver_provider_account_suspended(current_setting('t.drv')::uuid, 'linkwa', true, 'Chargeback under review')$$,
                 '42501', null, '19: suspending needs a fresh step-up');
select tests.login_as_mfa(current_setting('t.adm')::uuid);
select is((public.admin_set_driver_provider_account_suspended(current_setting('t.drv')::uuid, 'linkwa', true, 'Chargeback under review')).kyc_status,
          'suspended', '20: an admin with step-up suspends it');
select tests.as_owner();
select is(public.driver_provider_account_ready(current_setting('t.drv')::uuid), false, '21: a suspended driver is not ready');
select throws_ok($$delete from public.driver_provider_account_events$$, '42501', null, '22: the history is append-only');

-- ---------------------------------------------------------------- the gate (marketplace settlement on)
update public.system_settings set value = 'true'::jsonb where key = 'provider_marketplace_settlement';
create function pg_temp.provider_bid(_driver uuid) returns uuid language plpgsql as $f$
declare _job uuid;
begin
  perform tests.as_owner();
  _job := tests.create_job(current_setting('t.cust')::uuid, 340, 'direct');
  update public.jobs set payment_method = 'provider' where id = _job;
  return tests.create_bid(_job, _driver, 340);
end $f$;
select set_config('t.b1', pg_temp.provider_bid(current_setting('t.drv')::uuid)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.accept_bid(%L)$$, current_setting('t.b1')),
                   '%payout account is not approved%', '23: a suspended driver cannot be given an online-paid job');
select tests.login_as_mfa(current_setting('t.adm')::uuid);
select public.admin_set_driver_provider_account_suspended(current_setting('t.drv')::uuid, 'linkwa', false, 'Chargeback resolved');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.accept_bid(%L)$$, current_setting('t.b1')),
                '24: reinstated and ready: the same offer can be accepted');

select * from finish();
rollback;
