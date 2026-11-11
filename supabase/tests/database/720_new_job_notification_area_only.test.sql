-- 0140: the new-job notification reaches verified drivers with the area only, never the street address.
-- Each notification is found by its job_id (never by timestamp or text), so inserts in one transaction cannot be confused.
begin;
select plan(8);

select set_config('t.cust', tests.create_user('nj_cust')::text, true);
select set_config('t.drv', tests.create_driver('nj_drv', 100)::text, true);

select tests.as_owner();
delete from public.notifications where type = 'new_job';

do $$ declare _id uuid; begin
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method)
  values (current_setting('t.cust')::uuid, 'custom', 12, '12 Harward Road, Belvedere, Harare, Zimbabwe', 400, 'direct')
  returning id into _id;
  perform set_config('t.job1', _id::text, true);
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method)
  values (current_setting('t.cust')::uuid, 'custom', 5, '7 Main Street', 200, 'direct')
  returning id into _id;
  perform set_config('t.job2', _id::text, true);
end $$;

select is((select count(*)::int from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid
            and job_id = current_setting('t.job1')::uuid), 1, 'a verified driver is notified of the new open job');
select matches((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid
                 and job_id = current_setting('t.job1')::uuid), 'Belvedere, Harare', 'the notification names the area');
select doesnt_match((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid
                      and job_id = current_setting('t.job1')::uuid), 'Harward|Road', 'it does not contain the street');
select is((select count(*)::int from public.notifications where type = 'new_job' and user_id = current_setting('t.cust')::uuid), 0,
  'the customer is not sent a new-job notification');
select matches((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid
                 and job_id = current_setting('t.job2')::uuid), 'delivery to Area shared once you are selected',
  'an address with no usable area gives a generic message');
select doesnt_match((select body from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid
                      and job_id = current_setting('t.job2')::uuid), 'Main Street', 'and never the street');
select is((select count(*)::int from public.notifications where type = 'new_job' and job_id = current_setting('t.job1')::uuid
            and body ~* '12 Harward'), 0, 'no recipient anywhere sees the exact address for the first job');
select is((select count(*)::int from public.notifications where type = 'new_job' and user_id = current_setting('t.drv')::uuid), 2,
  'one notification per job, exactly');

select * from finish();
rollback;
