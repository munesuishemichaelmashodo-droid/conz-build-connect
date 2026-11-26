-- 0178: safety/fraud/harassment reports are urgent and alert admins; reporters choose a category; payments.paid_at
-- is set when a payment becomes paid.
begin;
select plan(6);

select tests.as_owner();
select set_config('t.cust', tests.create_user('rp_customer')::text, true);
select set_config('t.adm',  tests.create_user('rp_admin', array['admin'])::text, true);

select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok($$insert into public.reports (user_id, description, category) values (auth.uid(), 'Driver threatened me at the gate', 'safety')$$,
                '1: a signed-in user files a safety report with a category');
select lives_ok($$insert into public.reports (user_id, description) values (auth.uid(), 'App was slow today')$$,
                '2: a report without a category still works (general)');
select throws_ok($$insert into public.reports (user_id, description, category) values (auth.uid(), 'x x x x x', 'not_a_category')$$,
                 '23514', null, '3: an unknown category is refused');
select tests.as_owner();
select ok((select urgent from public.reports where description like 'Driver threatened%')
          and not (select urgent from public.reports where description = 'App was slow today'),
          '4: safety is urgent, general is not (set by the database, not the user)');
select ok((select count(*) from public.notifications where user_id = current_setting('t.adm')::uuid and type = 'urgent_report') = 1,
          '5: admins are alerted once for the urgent report');

insert into public.payments (id, user_id, type, amount, currency, status)
values ('00000000-0000-0000-0000-00000000c178', current_setting('t.cust')::uuid, 'topup', 10, 'USD', 'initiated');
update public.payments set status = 'paid' where id = '00000000-0000-0000-0000-00000000c178';
select isnt((select paid_at from public.payments where id = '00000000-0000-0000-0000-00000000c178'), null,
            '6: paid_at is set when a payment becomes paid');

select * from finish();
rollback;
