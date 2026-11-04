-- 0139: an invitation to bid is described as an invitation, never as priority or assignment.
begin;
select plan(7);

select set_config('t.cust', tests.create_user('rc_cust')::text, true);
select set_config('t.drv', tests.create_driver('rc_drv', 100)::text, true);
select set_config('t.other', tests.create_driver('rc_other', 100)::text, true);

select tests.as_owner();
insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method, preferred_driver_id)
values (current_setting('t.cust')::uuid, 'custom', 12, 'Test address', 400, 'direct', current_setting('t.drv')::uuid);

select is((select count(*)::int from public.notifications where type = 'repeat_customer' and user_id = current_setting('t.drv')::uuid), 1,
  'the invited driver gets one returning-customer notification');
select is((select count(*)::int from public.notifications where type = 'repeat_customer' and user_id = current_setting('t.other')::uuid), 0,
  'other drivers are not sent the invitation');
select matches((select body from public.notifications where type = 'repeat_customer' and user_id = current_setting('t.drv')::uuid),
  'invited you to send an offer', 'the text says it is an invitation to send an offer');
select matches((select body from public.notifications where type = 'repeat_customer' and user_id = current_setting('t.drv')::uuid),
  'open to other verified drivers', 'it says the job stays open to other verified drivers');
select matches((select body from public.notifications where type = 'repeat_customer' and user_id = current_setting('t.drv')::uuid),
  'customer makes the final choice', 'it says the customer decides');
select doesnt_match((select title || ' ' || body from public.notifications where type = 'repeat_customer' and user_id = current_setting('t.drv')::uuid),
  'lock it in|bid first|guarantee|assigned', 'it promises no priority, lock or assignment');
select is((select driver_id from public.jobs where preferred_driver_id = current_setting('t.drv')::uuid), null,
  'the invited driver is not assigned to the job');

select * from finish();
rollback;
