-- 0096 — delivery proof is enforced by the DATABASE for BOTH payment modes.
-- Direct-pay and escrow completion each need: real delivery evidence for this job and its
-- driver, the delivery code (valid, unexpired, unused), the right caller, and settle once.

begin;
select plan(54);
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('dp_cust')::text, true);
select set_config('t.cust2', tests.create_user('dp_cust2')::text, true);
select set_config('t.drv',   tests.create_driver('dp_drv', 100, true)::text, true);
select set_config('t.drv2',  tests.create_driver('dp_drv2', 100, true)::text, true);

-- ===========================================================================
-- DIRECT-PAY
-- ===========================================================================
select set_config('t.jd', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bd', tests.create_bid(current_setting('t.jd')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select set_config('t.jd2', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bd')::uuid);
select tests.as_owner();
select set_config('t.pin', (select pin from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid), true);

select is((select count(*)::int from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid), 1,
  '1: a delivery code is generated for a DIRECT-pay job when it is accepted');
select ok((select expires_at > now() and consumed_at is null from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid),
  '2: the code is unexpired and unused');
select tests.login_as(current_setting('t.cust')::uuid);
select is(public.get_my_delivery_pin(current_setting('t.jd')::uuid), current_setting('t.pin'), '3: the customer can read their code');
select tests.login_as(current_setting('t.drv')::uuid);
select is(public.get_my_delivery_pin(current_setting('t.jd')::uuid), null, '4: the driver cannot read the code');
select is((select count(*)::int from public.job_delivery_pins), 0, '5: the driver cannot select code rows either');

-- No evidence at all
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%evidence%', '6: direct-pay completion without delivery evidence is rejected');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.jd')::uuid), 'accepted', '7: the job did not complete');
select is(tests.balance(current_setting('t.drv')::uuid), 100.00::numeric, '8: no commission was charged');

-- A photo URL that is not backed by evidence for THIS job
insert into public.job_evidence (job_id, kind, storage_path, uploaded_by)
values (current_setting('t.jd2')::uuid, 'delivery', 'x/other-job.jpg', current_setting('t.drv')::uuid);
update public.jobs set delivery_photo_url = 'x/other-job.jpg' where id = current_setting('t.jd')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%evidence%', '9: evidence that belongs to another order is rejected');

-- Evidence for this job but uploaded by someone other than its driver
select tests.as_owner();
insert into public.job_evidence (job_id, kind, storage_path, uploaded_by)
values (current_setting('t.jd')::uuid, 'delivery', 'x/by-someone-else.jpg', current_setting('t.cust2')::uuid);
update public.jobs set delivery_photo_url = 'x/by-someone-else.jpg' where id = current_setting('t.jd')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%evidence%', '10: evidence uploaded by another user is rejected');

-- Wrong kind of evidence
select tests.as_owner();
insert into public.job_evidence (job_id, kind, storage_path, uploaded_by)
values (current_setting('t.jd')::uuid, 'pickup', 'x/pickup-photo.jpg', current_setting('t.drv')::uuid);
update public.jobs set delivery_photo_url = 'x/pickup-photo.jpg' where id = current_setting('t.jd')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%evidence%', '11: a pickup photo is not delivery evidence');

-- Real evidence now exists
select tests.as_owner();
insert into public.job_evidence (job_id, kind, storage_path, uploaded_by)
values (current_setting('t.jd')::uuid, 'delivery', 'jobs/dp/delivery.jpg', current_setting('t.drv')::uuid);
update public.jobs set delivery_photo_url = 'jobs/dp/delivery.jpg' where id = current_setting('t.jd')::uuid;

select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L)$$, current_setting('t.jd')),
  '%code is required%', '12: direct-pay completion without a code is rejected');
select throws_like(format($$select public.complete_job(%L, '')$$, current_setting('t.jd')),
  '%code is required%', '13: an empty code is rejected');
select is((public.complete_job(current_setting('t.jd')::uuid, '000000'))->>'error', 'wrong_pin', '14: a wrong code is refused');
select tests.as_owner();
select is((select attempts from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid), 1, '15: the wrong attempt was counted (it committed)');
select is((select status::text from public.jobs where id = current_setting('t.jd')::uuid), 'accepted', '16: still not completed');

-- Wrong callers
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%Only the customer%', '17: another customer cannot complete someone else''s order, even with the code');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%Only the customer%', '18: the driver cannot use the customer endpoint');
select tests.login_as(current_setting('t.drv2')::uuid);
select throws_like(format($$select public.driver_confirm_delivery_pin(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '%Not your job%', '19: a different driver cannot confirm this delivery');
select tests.as_anon();
select throws_ok(format($$select public.complete_job(%L, %L)$$, current_setting('t.jd'), current_setting('t.pin')),
  '42501', null, '20: an anonymous caller cannot complete anything');

-- Expired code: refused, not counted; the customer rotates it
select tests.as_owner();
update public.job_delivery_pins set expires_at = now() - interval '1 minute', attempts = 0
 where job_id = current_setting('t.jd')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.jd')::uuid, current_setting('t.pin')))->>'error', 'pin_expired',
  '21: an expired code is refused even when correct');
select tests.as_owner();
select is((select attempts from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid), 0, '22: expiry does not count as a wrong attempt');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.regenerate_delivery_pin(%L)$$, current_setting('t.jd')),
  '%Only the customer%', '23: the driver cannot generate a new code');
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.regenerate_delivery_pin(current_setting('t.jd')::uuid))->>'ok', 'true', '24: the customer can generate a new code');
select ok(public.get_my_delivery_pin_expiry(current_setting('t.jd')::uuid) > now() + interval '6 days', '25: the new code is valid for days');
select tests.as_owner();
select set_config('t.pin', (select pin from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid), true);

-- Brute force by the driver: 5 wrong codes lock the delivery, for the customer endpoint too
select tests.login_as(current_setting('t.drv')::uuid);
select public.driver_confirm_delivery_pin(current_setting('t.jd')::uuid, lpad(g::text, 6, '0')) from generate_series(1, 5) g;
select is((public.driver_confirm_delivery_pin(current_setting('t.jd')::uuid, current_setting('t.pin')))->>'error', 'locked',
  '26: after five wrong codes even the right code is refused (driver)');
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.jd')::uuid, current_setting('t.pin')))->>'error', 'locked',
  '27: the lock-out also holds on the customer endpoint');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'delivery_pin_failures'), 1,
  '28: the customer was warned once');
select tests.as_owner();
update public.job_delivery_pins set locked_until = null, attempts = 0 where job_id = current_setting('t.jd')::uuid;

-- Valid evidence + valid code
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.jd')::uuid, current_setting('t.pin')))->>'ok', 'true', '29: valid evidence + valid code completes the job');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.jd')::uuid), 'completed', '30: job completed');
select is((select commission from public.jobs where id = current_setting('t.jd')::uuid), 28.00::numeric, '31: flat 7% commission of $400 = $28.00');
select is(tests.balance(current_setting('t.drv')::uuid), 72.00::numeric, '32: commission debited once');
select ok((select consumed_at is not null from public.job_delivery_pins where job_id = current_setting('t.jd')::uuid), '33: the code is burnt');

-- Replay / repeat
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.jd')::uuid, current_setting('t.pin')))->>'already', 'true', '34: a repeated confirmation is a no-op');
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.driver_confirm_delivery_pin(current_setting('t.jd')::uuid, current_setting('t.pin')))->>'already', 'true', '35: a repeated driver confirmation is a no-op');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 72.00::numeric, '36: balance unchanged by repeats');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.jd')::uuid and type = 'commission'), 1, '37: one commission transaction only');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.regenerate_delivery_pin(%L)$$, current_setting('t.jd')),
  '%not in progress%', '38: a used code cannot be revived on a finished job');

-- A consumed code on a still-open job is refused
select tests.as_owner();
select set_config('t.bd2', tests.create_bid(current_setting('t.jd2')::uuid, current_setting('t.drv')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.bd2')::uuid);
select tests.as_owner();
select set_config('t.pin2', tests.deliver(current_setting('t.jd2')::uuid), true);
update public.job_delivery_pins set consumed_at = now() where job_id = current_setting('t.jd2')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.jd2')::uuid, current_setting('t.pin2')))->>'error', 'pin_used', '39: a previously used code is refused');

-- Driver completes a direct-pay job with the customer's code
select tests.as_owner();
update public.job_delivery_pins set consumed_at = null where job_id = current_setting('t.jd2')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
select is((public.driver_confirm_delivery_pin(current_setting('t.jd2')::uuid, current_setting('t.pin2')))->>'ok', 'true', '40: the driver can confirm a direct-pay delivery with the customer''s code');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 44.00::numeric, '41: second job charged the flat 7% once ($28)');

-- ===========================================================================
-- ESCROW — same protections (the customer endpoint used to need nothing)
-- ===========================================================================
select set_config('t.je', tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow')::text, true);
select set_config('t.be', tests.create_bid(current_setting('t.je')::uuid, current_setting('t.drv2')::uuid, 300)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.be')::uuid);
select tests.as_owner();
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, current_setting('t.je')::uuid, 'escrow', 300, 'USD', 'paynow', 'initiated')
returning set_config('t.pe', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.pe')::uuid, 'ipn', 'Paid', '300.00', current_setting('t.pe'));
select tests.as_owner();
select set_config('t.pine', (select pin from public.job_delivery_pins where job_id = current_setting('t.je')::uuid), true);

select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.je'), current_setting('t.pine')),
  '%evidence%', '42: escrow completion without delivery evidence is rejected');
select tests.as_owner();
select is((select status::text from public.payments where id = current_setting('t.pe')::uuid), 'paid', '43: the escrow was not released');
select tests.deliver(current_setting('t.je')::uuid);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_like(format($$select public.complete_job(%L)$$, current_setting('t.je')),
  '%code is required%', '44: escrow completion without a code is rejected');
select is((public.complete_job(current_setting('t.je')::uuid, '999999'))->>'error', 'wrong_pin', '45: a wrong code does not release escrow');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_like(format($$select public.complete_job(%L, %L)$$, current_setting('t.je'), current_setting('t.pine')),
  '%Only the customer%', '46: another customer cannot release this escrow');
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.je')::uuid, current_setting('t.pine')))->>'ok', 'true', '47: valid evidence + code releases escrow');
select tests.as_owner();
select is((select status::text from public.payments where id = current_setting('t.pe')::uuid), 'released', '48: payment released');
select is(tests.balance(current_setting('t.drv2')::uuid), 379.00::numeric, '49: driver receives $300 minus 7% ($21)');
select tests.login_as(current_setting('t.cust')::uuid);
select is((public.complete_job(current_setting('t.je')::uuid, current_setting('t.pine')))->>'already', 'true', '50: repeating it releases nothing more');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv2')::uuid), 379.00::numeric, '51: balance unchanged by the repeat');
select is((select count(*)::int from public.notifications where user_id = current_setting('t.drv2')::uuid and type = 'escrow_released'), 1, '52: one release notification, not two');
select is((select count(*)::int from public.wallet_transactions where job_id = current_setting('t.je')::uuid), 1, '53: one wallet transaction for the escrow job');
select ok((select bool_and(ok) from public.financial_reconciliation()
            where check_name in ('ledger_groups_balanced', 'escrow_held_matches_payments', 'released_escrow_posted_once',
                                 'no_stranded_escrow', 'held_commission_matches_jobs')),
  '54: ledger, escrow and held-commission reconciliation checks still pass after both settlements');

select * from finish();
rollback;
