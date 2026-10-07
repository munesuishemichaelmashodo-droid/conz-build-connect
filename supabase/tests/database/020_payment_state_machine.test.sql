-- Phases 2-3 / audit F3, F9 — payment state machine, Paynow result handling,
-- replay / regression / mismatch protection, reconciliation support.
--
-- apply_paynow_result() is what the IPN route, the poll path and the
-- server-side reconcile job call AFTER verifying the Paynow hash, so these
-- tests model "a correctly signed Paynow message arrives" — including
-- duplicates, replays, out-of-order and mismatched ones.

begin;
select plan(43);

select set_config('t.user',  tests.create_user('payer')::text, true);
select set_config('t.admin', tests.create_user('ops', array['admin'])::text, true);

-- Payment A: $50 top-up awaiting its result
insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url)
values (current_setting('t.user')::uuid, 'topup', 50, 'USD', 'paynow', 'initiated',
        'https://www.paynow.co.zw/Interface/CheckPayment/?guid=a')
returning set_config('t.pa', id::text, true);

-- Payment B: $20 top-up
insert into public.payments (user_id, type, amount, currency, method, status, paynow_poll_url)
values (current_setting('t.user')::uuid, 'topup', 20, 'USD', 'paynow', 'initiated',
        'https://www.paynow.co.zw/Interface/CheckPayment/?guid=b')
returning set_config('t.pb', id::text, true);

select tests.as_service();

-- ---------------------------------------------------------------------------
-- I-2 / I-3: first valid Paid credits exactly once
-- ---------------------------------------------------------------------------
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'ipn', 'Paid', '50.00', current_setting('t.pa'), 'PN-1')->>'outcome',
  'credited', 'Valid Paid IPN credits the top-up');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 50.00::numeric, 'Wallet credited $50');
select is((select status from public.payments where id = current_setting('t.pa')::uuid), 'paid', 'Payment is paid');
select ok((select paid_at is not null from public.payments where id = current_setting('t.pa')::uuid), 'paid_at stamped');
select is((select paynow_reference from public.payments where id = current_setting('t.pa')::uuid), 'PN-1', 'Paynow reference stored');

select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'ipn', 'Paid', '50.00', current_setting('t.pa'), 'PN-1')->>'outcome',
  'duplicate_ignored', 'Duplicate Paid IPN is ignored');
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'poll', 'Paid', '50.00', current_setting('t.pa'), 'PN-1')->>'outcome',
  'duplicate_ignored', 'Poll result after IPN is ignored');

-- Out-of-order / regression attempts
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'ipn', 'Cancelled', '50.00', current_setting('t.pa'))->>'outcome',
  'regression_blocked', 'Late Cancelled cannot regress a paid payment');
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'ipn', 'Failed', '50.00', current_setting('t.pa'))->>'outcome',
  'regression_blocked', 'Late Failed cannot regress a paid payment');
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'ipn', 'Refunded', '50.00', current_setting('t.pa'))->>'outcome',
  'reversal_flagged', 'Refund after payment is flagged, not silently applied');
-- The original F3 attack: replay the signed Paid body after a reversal
select is(public.apply_paynow_result(current_setting('t.pa')::uuid, 'ipn', 'Paid', '50.00', current_setting('t.pa'), 'PN-1')->>'outcome',
  'duplicate_ignored', 'F3: replayed Paid after a reversal does not credit again');

select tests.as_owner();
select is((select status from public.payments where id = current_setting('t.pa')::uuid), 'paid', 'Status still paid after all late events');
select is(tests.balance(current_setting('t.user')::uuid), 50.00::numeric, 'F3: balance still exactly $50 (credited once)');
select ok(tests.ledger_matches(current_setting('t.user')::uuid), 'Ledger invariant holds');
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.admin')::uuid and type = 'payment_anomaly'),
  'Admins alerted about the post-payment reversal');
select is((select count(*)::int from public.payment_events where payment_id = current_setting('t.pa')::uuid), 7,
  'Every observation was recorded in payment_events');

-- ---------------------------------------------------------------------------
-- Mismatches (payment B)
-- ---------------------------------------------------------------------------
select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Paid', '20.00', current_setting('t.pa'))->>'outcome',
  'rejected_reference_mismatch', 'Payment B given payment A''s result is rejected');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Paid', '200.00', current_setting('t.pb'))->>'outcome',
  'rejected_amount_mismatch', 'Wrong amount is rejected');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Paid', '19.99', current_setting('t.pb'))->>'outcome',
  'rejected_amount_mismatch', 'Short payment is rejected');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Paid', 'NaN', current_setting('t.pb'))->>'outcome',
  'rejected_amount_mismatch', 'NaN amount is rejected');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Paid', 'abc', current_setting('t.pb'))->>'outcome',
  'rejected_amount_mismatch', 'Garbage amount is rejected');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Paid', null, current_setting('t.pb'))->>'outcome',
  'rejected_amount_mismatch', 'Missing amount is rejected');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'poll', 'Sent', '20.00', current_setting('t.pb'))->>'outcome',
  'pending_no_change', 'Still-pending status changes nothing');
select tests.as_owner();
select is(tests.balance(current_setting('t.user')::uuid), 50.00::numeric, 'No credit from any mismatched result');
select is((select status from public.payments where id = current_setting('t.pb')::uuid), 'initiated', 'Payment B still initiated');

select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'ipn', 'Cancelled', '20.00', current_setting('t.pb'))->>'outcome',
  'closed_unpaid', 'Cancelled closes an unpaid payment');
select is(public.apply_paynow_result(current_setting('t.pb')::uuid, 'ipn', 'Paid', '20.00', current_setting('t.pb'))->>'outcome',
  'late_success_flagged', 'Paid after cancel is flagged, never auto-credited');
select tests.as_owner();
select is((select status from public.payments where id = current_setting('t.pb')::uuid), 'cancelled', 'Payment B stays cancelled');
select is(tests.balance(current_setting('t.user')::uuid), 50.00::numeric, 'Late success did not credit');

-- ---------------------------------------------------------------------------
-- The state machine holds for every role, including service_role
-- ---------------------------------------------------------------------------
select tests.as_service();
select throws_ok(format($$update public.payments set status = 'paid' where id = %L$$, current_setting('t.pb')),
  '42501', null, 'cancelled -> paid is illegal even for service_role');
select throws_ok(format($$update public.payments set status = 'failed' where id = %L$$, current_setting('t.pa')),
  '42501', null, 'paid -> failed is illegal even for service_role');
select throws_ok(format($$update public.payments set amount = 5000 where id = %L$$, current_setting('t.pa')),
  '42501', null, 'Payment amount is immutable');
select throws_ok(format($$select public.credit_wallet_from_payment(%L)$$, current_setting('t.pb')),
  null, null, 'A cancelled payment can never be credited directly');
select throws_ok(format($$delete from public.payments where id = %L$$, current_setting('t.pa')),
  '42501', null, 'Payments cannot be deleted');
select throws_ok(format($$delete from public.payment_events where payment_id = %L$$, current_setting('t.pa')),
  '42501', null, 'payment_events is append-only');

-- ---------------------------------------------------------------------------
-- Escrow payments are marked paid, never credited to a wallet
-- ---------------------------------------------------------------------------
select tests.as_owner();
select set_config('t.drv', tests.create_driver('escdrv', 0)::text, true);
select set_config('t.job', tests.create_job(current_setting('t.user')::uuid, 300, 'escrow')::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.drv')::uuid, final_price = 300
 where id = current_setting('t.job')::uuid;
insert into public.payments (user_id, job_id, type, amount, currency, method, status, paynow_poll_url)
values (current_setting('t.user')::uuid, current_setting('t.job')::uuid, 'escrow', 300, 'USD', 'paynow', 'initiated',
        'https://www.paynow.co.zw/Interface/CheckPayment/?guid=e')
returning set_config('t.pe', id::text, true);
select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.pe')::uuid, 'ipn', 'Paid', '300.00', current_setting('t.pe'))->>'outcome',
  'escrow_marked_paid', 'Escrow payment is marked paid');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid) + tests.balance(current_setting('t.user')::uuid), 50.00::numeric,
  'Escrow payment credited nobody''s wallet');

-- ---------------------------------------------------------------------------
-- Client access
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.user')::uuid);
select throws_ok($$select paynow_poll_url from public.payments$$, '42501', null,
  'F3: users can no longer read their poll URL (replay source)');
select is((select count(*)::int from public.payments), 3, 'Users still see their own payments (safe columns)');
select throws_ok(format($$select public.apply_paynow_result(%L, 'ipn', 'Paid', '20.00', %L)$$, current_setting('t.pb'), current_setting('t.pb')),
  '42501', null, 'Clients cannot call apply_paynow_result');
select is((select count(*)::int from public.payment_events), 0, 'Clients cannot read payment_events');

-- ---------------------------------------------------------------------------
-- Reconciliation support
-- ---------------------------------------------------------------------------
select tests.as_owner();
insert into public.payments (user_id, type, amount, currency, method, status, created_at)
values (current_setting('t.user')::uuid, 'topup', 10, 'USD', 'paynow', 'initiated', now() - interval '2 hours')
returning set_config('t.pu', id::text, true);
select tests.as_service();
select is(public.expire_stale_paynow_payment(current_setting('t.pu')::uuid), 'expired',
  'An initiated payment that never reached Paynow is expired after 1h');
select is(public.request_paynow_reconcile(), 'not_configured',
  'Reconcile cron is inert until the owner configures the endpoint secret');

select * from finish();
rollback;
