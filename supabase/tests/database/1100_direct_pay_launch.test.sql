-- 0176: free first job retired whatever the promo switch says; the driver's confirmation of a direct payment is
-- stored once, readable only by the job's parties and admins, never changes commission, and is never "verified".
begin;
select plan(20);

select tests.as_owner();
update public.system_settings set value = 'false'::jsonb where key = 'promo_credit_enabled';

-- ---------------------------------------------------------------- 1. free first job retired
select set_config('t.cust', tests.create_user('dp_customer')::text, true);
select set_config('t.other', tests.create_user('dp_stranger')::text, true);
select set_config('t.adm', tests.create_user('dp_admin', array['admin'])::text, true);
select set_config('t.drv', tests.create_driver('dp_driver', 50, false)::text, true);   -- asks for an unused free job
select is((select first_job_free_used from public.driver_profiles where user_id = current_setting('t.drv')::uuid), true,
          '1: a new driver never starts with a free first job, even with promo credit switched off');
-- A $400 direct job (materials $300 + transport $100), accepted: 7% reserved.
create function pg_temp.direct_job(_price numeric) returns uuid language plpgsql as $f$
declare _job uuid; _bid uuid;
begin
  perform tests.as_owner();
  _job := tests.create_job(current_setting('t.cust')::uuid, _price, 'direct');
  _bid := tests.create_bid(_job, current_setting('t.drv')::uuid, _price);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_bid);
  perform tests.as_owner();
  return _job;
end $f$;
select set_config('t.job', pg_temp.direct_job(400)::text, true);
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 28.00::numeric,
          '2: the former "free job" driver has the full 7% reserved ($28 on $400)');

-- ---------------------------------------------------------------- 2. who may confirm
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.driver_confirm_direct_payment(%L, 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '3: the customer cannot confirm the driver was paid');
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format($$select public.driver_confirm_direct_payment(%L, 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '4: a stranger cannot confirm it');
select tests.as_anon();
select throws_ok(format($$select public.driver_confirm_direct_payment(%L, 'cash', 400)$$, current_setting('t.job')),
                 '42501', null, '5: a visitor cannot call it');
select tests.login_as(current_setting('t.drv')::uuid);
select throws_like(format($$select public.driver_confirm_direct_payment(%L, 'bitcoin', 400)$$, current_setting('t.job')),
                   '%Choose how you were paid%', '6: an unknown method is refused');
select throws_like(format($$select public.driver_confirm_direct_payment(%L, 'cash', 0)$$, current_setting('t.job')),
                   '%amount you received%', '7: a zero amount is refused');
select throws_ok($$insert into public.direct_payment_confirmations (job_id, driver_id, method, amount, agreed_amount) values
                   (current_setting('t.job')::uuid, current_setting('t.drv')::uuid, 'cash', 400, 400)$$,
                 '42501', null, '8: nobody writes the table directly');

-- ---------------------------------------------------------------- 3. confirm once
select lives_ok(format($$select public.driver_confirm_direct_payment(%L, 'ecocash', 400, 'MP2511.1044.A12345')$$, current_setting('t.job')),
                '9: the driver confirms $400 by EcoCash with its reference');
select lives_ok(format($$select public.driver_confirm_direct_payment(%L, 'ecocash', 400, 'MP2511.1044.A12345')$$, current_setting('t.job')),
                '10: repeating the same confirmation is harmless');
select throws_like(format($$select public.driver_confirm_direct_payment(%L, 'cash', 350)$$, current_setting('t.job')),
                   '%already confirmed%', '11: a different second confirmation is refused');
select tests.as_owner();
select is((select count(*)::int from public.direct_payment_confirmations where job_id = current_setting('t.job')::uuid), 1,
          '12: exactly one confirmation is stored');
select throws_ok($$update public.direct_payment_confirmations set amount = 1 where job_id = current_setting('t.job')::uuid$$,
                 '42501', null, '13: it cannot be edited, even by the database owner');
select throws_ok($$delete from public.direct_payment_confirmations where job_id = current_setting('t.job')::uuid$$,
                 '42501', null, '14: or deleted');
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 28.00::numeric,
          '15: confirming the payment does not touch the commission reserve');
select ok(exists (select 1 from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'payment_confirmed'),
          '16: the customer is told the driver confirmed (and that Con Z did not handle it)');

-- ---------------------------------------------------------------- 4. who can read it
select tests.login_as(current_setting('t.cust')::uuid);
select is((select reference from public.direct_payment_confirmations where job_id = current_setting('t.job')::uuid), 'MP2511.1044.A12345',
          '17: the customer can read it');
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.direct_payment_confirmations), 0, '18: a stranger cannot');

-- ---------------------------------------------------------------- 5. a different amount is flagged, commission unchanged
select tests.as_owner();
update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.job')::uuid);
select tests.as_owner();
select set_config('t.job2', pg_temp.direct_job(200)::text, true);
select tests.login_as(current_setting('t.drv')::uuid);
select public.driver_confirm_direct_payment(current_setting('t.job2')::uuid, 'cash', 150);
select tests.as_owner();
select ok(exists (select 1 from public.notifications n join public.user_roles ur on ur.user_id = n.user_id and ur.role = 'admin'
                   where n.job_id = current_setting('t.job2')::uuid and n.type = 'payment_anomaly'),
          '19: a confirmed amount below the agreed price is flagged to admins');
select is((select held_commission from public.jobs where id = current_setting('t.job2')::uuid), 14.00::numeric,
          '20: commission stays 7% of the agreed $200 ($14), not of the $150 confirmed');

select * from finish();
rollback;
