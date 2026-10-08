-- Phase 8 / audit F7 (+ escrow delivery PIN) — PIN lockouts must actually
-- count failures, survive the request, and not be bypassable.
--
-- Before 0078 this file's first assertion failed (fail_count stayed 0): the
-- functions incremented the counter and then RAISED, which rolled the
-- increment back with the rest of the request.

begin;
select plan(31);

select set_config('t.a', tests.create_driver('pinA', 100)::text, true);
select set_config('t.b', tests.create_driver('pinB', 100)::text, true);

create or replace function pg_temp.fails(_u text) returns integer language sql as $$
  select coalesce((select fail_count from public.pin_attempts where user_id = current_setting(_u)::uuid), 0)
$$;
create or replace function pg_temp.locked(_u text) returns boolean language sql as $$
  select coalesce((select locked_until > now() from public.pin_attempts where user_id = current_setting(_u)::uuid), false)
$$;

-- ===========================================================================
-- Withdrawal PIN via request_withdrawal
-- ===========================================================================
select tests.login_as(current_setting('t.a')::uuid);
select is((public.set_withdrawal_pin('4826', null))->>'ok', 'true', 'PIN set');

select is((public.request_withdrawal(10, 'ecocash', '0771234567', '0001'))->>'error', 'wrong_pin', 'Wrong PIN 1 is reported, not raised');
select tests.as_owner();
select is(pg_temp.fails('t.a'), 1, 'F7: the failure is counted (was 0 before 0078)');
select tests.login_as(current_setting('t.a')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '0002'))->>'error', 'wrong_pin', 'Wrong PIN 2');
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '0003'))->>'error', 'wrong_pin', 'Wrong PIN 3');
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '0004'))->>'attempts_left', '1', 'One attempt left after 4 failures');
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '0005'))->>'error', 'locked', 'F7: 5th failure locks the PIN');
select tests.as_owner();
select ok(pg_temp.locked('t.a'), 'F7: lockout recorded');
select tests.login_as(current_setting('t.a')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '4826'))->>'error', 'locked',
  'F7: even the CORRECT PIN is refused while locked (no oracle)');
select is((public.set_withdrawal_pin('1111', '4826'))->>'error', 'locked',
  'F7: changing the PIN is refused while locked');
select tests.as_owner();
select is((select count(*)::int from public.wallet_withdrawal_requests where user_id = current_setting('t.a')::uuid), 0,
  'No withdrawal was created by any of these attempts');
select is(pg_temp.fails('t.a'), 5, 'Attempts during the lockout do not reset the counter');

-- Lock expires -> correct PIN works and resets the counter
update public.pin_attempts set locked_until = now() - interval '1 second' where user_id = current_setting('t.a')::uuid;
select tests.login_as(current_setting('t.a')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '4826'))->>'ok', 'true', 'Correct PIN after the lockout works');
select tests.as_owner();
select is(pg_temp.fails('t.a'), 0, 'Counter reset only by a correct PIN');

-- Escalation: 10+ failures -> 24h
update public.pin_attempts set fail_count = 9, locked_until = null where user_id = current_setting('t.a')::uuid;
update public.wallet_withdrawal_requests set status = 'cancelled' where user_id = current_setting('t.a')::uuid;
select tests.login_as(current_setting('t.a')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '9999'))->>'error', 'locked', '10th failure locks');
select tests.as_owner();
select ok((select locked_until > now() + interval '23 hours' from public.pin_attempts where user_id = current_setting('t.a')::uuid),
  'F7: repeated brute force escalates to a 24h lockout');

-- ===========================================================================
-- The originally reported oracle: set_withdrawal_pin(new, current)
-- ===========================================================================
select tests.login_as(current_setting('t.b')::uuid);
select public.set_withdrawal_pin('2468', null);
select is((public.set_withdrawal_pin('1111', '0000'))->>'error', 'wrong_pin', 'Wrong current PIN on change is reported');
select is((public.set_withdrawal_pin('1111', '0001'))->>'error', 'wrong_pin', 'Wrong current PIN 2');
select is((public.set_withdrawal_pin('1111', '0002'))->>'error', 'wrong_pin', 'Wrong current PIN 3');
select tests.as_owner();
select is(pg_temp.fails('t.b'), 3, 'F7: change-PIN failures are counted');
select tests.login_as(current_setting('t.b')::uuid);
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '0003'))->>'error', 'wrong_pin', 'Shared counter: 4th failure via withdrawal');
select is((public.set_withdrawal_pin('1111', '0004'))->>'error', 'locked', 'F7: the change-PIN path and the withdrawal path share one lockout');
select tests.as_owner();
update public.pin_attempts set locked_until = now() - interval '1 second' where user_id = current_setting('t.b')::uuid;
select tests.login_as(current_setting('t.b')::uuid);
select is((public.set_withdrawal_pin('1357', '2468'))->>'ok', 'true', 'Correct current PIN changes it');
select is((public.request_withdrawal(10, 'ecocash', '0771234567', '2468'))->>'error', 'wrong_pin', 'Old PIN no longer works');

-- ===========================================================================
-- Escrow delivery PIN (driver could brute-force the customer's code)
-- ===========================================================================
select tests.as_owner();
select set_config('t.cust', tests.create_user('pincust')::text, true);
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow')::text, true);
update public.jobs set status = 'in_progress', driver_id = current_setting('t.a')::uuid, final_price = 300,
       delivery_photo_url = 'job/delivery.jpg' where id = current_setting('t.job')::uuid;
insert into public.job_delivery_pins (job_id, pin) values (current_setting('t.job')::uuid, '482913')
  on conflict (job_id) do update set pin = excluded.pin, attempts = 0, locked_until = null;
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, current_setting('t.job')::uuid, 'escrow', 300, 'USD', 'paynow', 'initiated')
returning set_config('t.pay', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.pay')::uuid, 'ipn', 'Paid', '300.00', current_setting('t.pay'));

select tests.login_as(current_setting('t.a')::uuid);
select public.driver_confirm_delivery_pin(current_setting('t.job')::uuid, lpad(g::text, 6, '0')) from generate_series(1, 5) g;
select tests.as_owner();
select is((select attempts from public.job_delivery_pins where job_id = current_setting('t.job')::uuid), 5,
  'Delivery PIN: wrong guesses are counted (was rolled back before 0078)');
select ok((select locked_until > now() from public.job_delivery_pins where job_id = current_setting('t.job')::uuid),
  'Delivery PIN: locked after 5 wrong guesses');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'delivery_pin_failures'),
  'Customer warned about repeated wrong codes');
select tests.login_as(current_setting('t.a')::uuid);
select is((public.driver_confirm_delivery_pin(current_setting('t.job')::uuid, '482913'))->>'error', 'locked',
  'Delivery PIN: the correct code is refused while locked (no oracle)');
select tests.as_owner();
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'paid', 'Escrow still held');
update public.job_delivery_pins set locked_until = now() - interval '1 second' where job_id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.a')::uuid);
select is((public.driver_confirm_delivery_pin(current_setting('t.job')::uuid, '482913'))->>'ok', 'true',
  'Correct code after the lockout releases escrow');
select tests.as_owner();
select is((select status from public.payments where id = current_setting('t.pay')::uuid), 'released', 'Escrow released once');

select * from finish();
rollback;
