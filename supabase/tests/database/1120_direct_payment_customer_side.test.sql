-- 0178: the customer's side of a direct payment (report, acknowledge), write-once and party-only; safety/fraud
-- report categories alert admins; payments.paid_at is set when a payment becomes paid.
begin;
select plan(26);

select tests.as_owner();
select set_config('t.cust',  tests.create_user('cs_customer')::text, true);
select set_config('t.cust2', tests.create_user('cs_other_customer')::text, true);
select set_config('t.adm',   tests.create_user('cs_admin', array['admin'])::text, true);
select set_config('t.drv',   tests.create_driver('cs_driver', 50)::text, true);
select set_config('t.drv2',  tests.create_driver('cs_other_driver', 50)::text, true);

create function pg_temp.direct_job(_price numeric, _drv uuid) returns uuid language plpgsql as $f$
declare _job uuid; _bid uuid;
begin
  perform tests.as_owner();
  _job := tests.create_job(current_setting('t.cust')::uuid, _price, 'direct');
  _bid := tests.create_bid(_job, _drv, _price);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_bid);
  perform tests.as_owner();
  return _job;
end $f$;
select set_config('t.job', pg_temp.direct_job(400, current_setting('t.drv')::uuid)::text, true);
select set_config('t.held', (select held_commission from public.jobs where id = current_setting('t.job')::uuid)::text, true);

-- ---------------------------------------------------------------- who may report
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$select public.customer_report_direct_payment(%L, 'ecocash', 400)$$, current_setting('t.job')),
                 '42501', null, '1: the driver cannot report the customer''s payment');
select tests.login_as(current_setting('t.cust2')::uuid);
select throws_ok(format($$select public.customer_report_direct_payment(%L, 'ecocash', 400)$$, current_setting('t.job')),
                 '42501', null, '2: another customer cannot');
select tests.as_anon();
select throws_ok(format($$select public.customer_report_direct_payment(%L, 'ecocash', 400)$$, current_setting('t.job')),
                 '42501', null, '3: a visitor cannot');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$insert into public.direct_payment_customer_records (job_id, customer_id, agreed_amount) values (gen_random_uuid(), auth.uid(), 1)$$,
                 '42501', null, '4: nobody writes the table directly');
select throws_like(format($$select public.customer_acknowledge_direct_payment(%L)$$, current_setting('t.job')),
                   '%has not confirmed%', '5: nothing to acknowledge before the driver confirms');

-- ---------------------------------------------------------------- the customer reports "I paid"
select throws_like(format($$select public.customer_report_direct_payment(%L, 'crypto', 400)$$, current_setting('t.job')),
                   '%Choose how you paid%', '6: unknown method refused');
select throws_like(format($$select public.customer_report_direct_payment(%L, 'ecocash', 0)$$, current_setting('t.job')),
                   '%amount%', '7: zero amount refused');
select is((public.customer_report_direct_payment(current_setting('t.job')::uuid, 'ecocash', 400, ' MP123 ')).reference, 'MP123',
          '8: the customer''s report is saved (reference trimmed)');
select is((public.customer_report_direct_payment(current_setting('t.job')::uuid, 'ecocash', 400, 'MP123')).amount, 400.00::numeric,
          '9: the same report again is accepted unchanged (idempotent)');
select throws_like(format($$select public.customer_report_direct_payment(%L, 'cash', 350)$$, current_setting('t.job')),
                   '%already reported%', '10: a different report is refused (raise a dispute instead)');
select tests.as_owner();
select is((select count(*)::int from public.notifications where user_id = current_setting('t.drv')::uuid and type = 'payment_reported'
             and job_id = current_setting('t.job')::uuid), 1, '11: the driver is told once');
select is((select count(*)::int from public.notifications where type = 'payment_anomaly' and job_id = current_setting('t.job')::uuid), 0,
          '12: no admin alert when the amount matches the agreed price');
select throws_ok(format($$update public.direct_payment_customer_records set amount = 1 where job_id = %L$$, current_setting('t.job')),
                 '42501', null, '13: a report cannot be changed, even by the owner role');
select throws_ok(format($$delete from public.direct_payment_customer_records where job_id = %L$$, current_setting('t.job')),
                 '42501', null, '14: nor deleted');

-- ---------------------------------------------------------------- driver confirms, customer acknowledges
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$select public.driver_confirm_direct_payment(%L, 'ecocash', 400, 'MP123')$$, current_setting('t.job')),
                '15: the driver confirms receipt (0176)');
select tests.login_as(current_setting('t.cust')::uuid);
select isnt((public.customer_acknowledge_direct_payment(current_setting('t.job')::uuid)).acknowledged_at, null,
            '16: the customer acknowledges the driver''s confirmation');
select is((select (public.customer_acknowledge_direct_payment(current_setting('t.job')::uuid)).method), 'ecocash',
          '17: acknowledging again changes nothing');

-- ---------------------------------------------------------------- who can read
select tests.login_as(current_setting('t.drv')::uuid);
select is((select count(*)::int from public.direct_payment_customer_records where job_id = current_setting('t.job')::uuid), 1,
          '18: the job''s driver reads the customer''s record');
select tests.login_as(current_setting('t.drv2')::uuid);
select is((select count(*)::int from public.direct_payment_customer_records), 0, '19: another driver reads nothing');
select tests.login_as(current_setting('t.cust2')::uuid);
select is((select count(*)::int from public.direct_payment_customer_records), 0, '20: another customer reads nothing');
select tests.login_as(current_setting('t.adm')::uuid);
select is((select count(*)::int from public.direct_payment_customer_records where job_id = current_setting('t.job')::uuid), 1,
          '21: admins read it');

-- ---------------------------------------------------------------- mismatch alerts admins; commission untouched
select set_config('t.job2', pg_temp.direct_job(300, current_setting('t.drv2')::uuid)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.customer_report_direct_payment(%L, 'cash', 250)$$, current_setting('t.job2')),
                '22: a report of less than the agreed price is still recorded');
select tests.as_owner();
select ok((select count(*) from public.notifications where type = 'payment_anomaly' and job_id = current_setting('t.job2')::uuid) >= 1,
          '23: and admins are alerted');
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid)::text, current_setting('t.held'),
          '24: commission reserved on the first job is unchanged by any payment record');

-- ---------------------------------------------------------------- reports: urgent categories
select tests.login_as(current_setting('t.cust')::uuid);
insert into public.reports (user_id, job_id, description, category)
values (auth.uid(), current_setting('t.job')::uuid, 'Driver asked me to pay a stranger''s number', 'fraud_scam');
select tests.as_owner();
select ok((select urgent from public.reports where user_id = current_setting('t.cust')::uuid and category = 'fraud_scam')
          and (select count(*) from public.notifications where type = 'urgent_report' and job_id = current_setting('t.job')::uuid) >= 1,
          '25: a fraud report is urgent and admins are notified');

-- ---------------------------------------------------------------- payments.paid_at
insert into public.payments (id, user_id, type, amount, currency, status)
values ('00000000-0000-0000-0000-00000000c178', current_setting('t.drv')::uuid, 'topup', 10, 'USD', 'initiated');
update public.payments set status = 'paid' where id = '00000000-0000-0000-0000-00000000c178';
select isnt((select paid_at from public.payments where id = '00000000-0000-0000-0000-00000000c178'), null,
            '26: paid_at is set when a payment becomes paid');

select * from finish();
rollback;
