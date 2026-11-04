-- 0140: the new-job notification reaches verified drivers with the area only, never the street address.
begin;
select plan(7);

select set_config('t.cust', tests.create_user('nj_cust')::text, true);
select set_config('t.drv', tests.create_driver('nj_drv', 100)::text, true);

select tests.as_owner();
delete from public.notifications where type = 'new_job';
insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method)
values (current_setting('t.cust')::uuid, 'custom', 12, '12 Harward Road, Belvedere, Harare, Zimbabwe', 400, 'direct');

select is((select count(*)::int from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid), 1,
  'a verified driver is still notified of a new open job');
select matches((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid),
  'Belvedere, Harare', 'the notification names the area');
select doesnt_match((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid),
  'Harward|12 Harward|Road', 'it does not contain the street or number');
select is((select count(*)::int from public.notifications where type = 'new_job' and user_id = current_setting('t.cust')::uuid), 0,
  'the customer is not sent a new-job notification');

insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method)
values (current_setting('t.cust')::uuid, 'custom', 5, '7 Main Street', 200, 'direct');
select matches((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid and body not like '12%'),
  'delivery to Area shared once you are selected', 'an address with no usable area gives a generic message, not the street');
select doesnt_match((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid and body not like '12%'),
  'Main Street', 'and never the street');
select doesnt_match((select string_agg(body, ' ') from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid),
  'Harward', 'no new-job notification text anywhere carries the street');

select * from finish();
rollback;
