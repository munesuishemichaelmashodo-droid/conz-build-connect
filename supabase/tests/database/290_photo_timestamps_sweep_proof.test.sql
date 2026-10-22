-- 0099 — regression: a driver must not be able to backdate the delivery-photo clock and get an
-- escrow auto-release (no customer code, no 72h dispute window). Reproduced before the fix.

begin;
select plan(12);
select tests.enable_launch_features();

select set_config('t.cust', tests.create_user('ph_cust')::text, true);
select set_config('t.drv',  tests.create_driver('ph_drv', 100, true)::text, true);
select set_config('t.adm',  tests.create_user('ph_adm', array['admin'])::text, true);

-- An accepted, PAID escrow job ($300).
create or replace function pg_temp.paid_escrow_job() returns uuid language plpgsql as $$
declare _j uuid; _b uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow');
  _b := tests.create_bid(_j, current_setting('t.drv')::uuid, 300);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_b);
  perform tests.as_owner();
  insert into public.payments (user_id, job_id, type, amount, currency, method, status)
  values (current_setting('t.cust')::uuid, _j, 'escrow', 300, 'USD', 'paynow', 'initiated');
  perform tests.as_service();
  perform public.apply_paynow_result(p.id, 'ipn', 'Paid', '300.00', p.id::text) from public.payments p where p.job_id = _j;
  perform tests.as_owner();
  return _j;
end $$;

-- ---- A. the attack, run as the driver only ------------------------------------------------
select set_config('t.ja', pg_temp.paid_escrow_job()::text, true);
-- (0110) Delivery proof now needs the real sequence: uploaded files, pickup photo, trip started.
insert into storage.objects (bucket_id, name) values
  ('job-proof-photos', current_setting('t.ja') || '/pickup-a.jpg'),
  ('job-proof-photos', current_setting('t.ja') || '/delivery-a.jpg');
select tests.login_as(current_setting('t.drv')::uuid);
select public.record_job_evidence(current_setting('t.ja')::uuid, 'pickup', current_setting('t.ja') || '/pickup-a.jpg');
select public.start_trip(current_setting('t.ja')::uuid);
select lives_ok(format($$select public.record_job_evidence(%L, 'delivery', %L, 1000, 'image/jpeg', -17.8, 31.0, 10, 'captured')$$,
  current_setting('t.ja'), current_setting('t.ja') || '/delivery-a.jpg'), 'A: the driver legitimately records delivery evidence');
select ok((select delivery_photo_taken_at from public.jobs where id = current_setting('t.ja')::uuid) > now() - interval '5 minutes',
  'A: the system stamps the photo time (now)');
select throws_ok(format($$update public.jobs set delivery_photo_taken_at = now() - interval '80 hours' where id = %L$$, current_setting('t.ja')),
  '42501', null, 'A: the driver cannot backdate delivery_photo_taken_at');
select throws_ok(format($$update public.jobs set pickup_photo_taken_at = now() - interval '80 hours' where id = %L$$, current_setting('t.ja')),
  '42501', null, 'A: the driver cannot write pickup_photo_taken_at either');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$update public.jobs set delivery_photo_taken_at = now() - interval '80 hours' where id = %L$$, current_setting('t.ja')),
  '42501', null, 'A: the customer cannot write it');
select tests.as_service();
select is(public.auto_release_escrow_payments(), 0, 'A: the sweep releases nothing for a fresh delivery photo');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.ja')::uuid), 'in_progress',
  'A: the job is still waiting for the customer (no instant payout)');
select is(tests.balance(current_setting('t.drv')::uuid), 100::numeric, 'A: the driver wallet is untouched');

-- ---- B. the legitimate 72h path still works ----------------------------------------------------
-- (time passes: the system-side clock is moved by the database owner, standing in for 72h elapsing)
update public.jobs set delivery_photo_taken_at = now() - interval '80 hours' where id = current_setting('t.ja')::uuid;
select tests.as_service();
select is(public.auto_release_escrow_payments(), 1, 'B: after 72h with real evidence and no dispute the sweep releases the escrow');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 379::numeric, 'B: the driver receives $300 - 7% = $279');
select is(public.auto_release_escrow_payments(), 0, 'B: a second sweep releases nothing (exactly once)');

-- ---- C. an old timestamp with no evidence behind it never releases ----------------------------
select set_config('t.jc', pg_temp.paid_escrow_job()::text, true);
update public.jobs set delivery_photo_url = 'forged/path.jpg', delivery_photo_taken_at = now() - interval '80 hours'
 where id = current_setting('t.jc')::uuid;
select tests.as_service();
select is(public.auto_release_escrow_payments(), 0, 'C: a photo URL/timestamp without a real evidence row is not proof');

select * from finish();
rollback;
