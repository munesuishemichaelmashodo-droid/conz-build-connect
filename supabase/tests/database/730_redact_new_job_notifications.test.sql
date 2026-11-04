-- The one-off redaction (supabase/maintenance/20261104_redact_new_job_notification_addresses.sql) changes only the body
-- of other drivers' new_job notifications. The UPDATE below is the script's statement, kept identical (a unit test compares them).
begin;
select plan(9);

select set_config('t.cust', tests.create_user('rd_cust')::text, true);
select set_config('t.sel', tests.create_driver('rd_sel', 100)::text, true);
select set_config('t.oth', tests.create_driver('rd_oth', 100)::text, true);
select tests.as_owner();
create temp table _before as select * from public.notifications limit 0;

-- Old-style notifications (exact address in the text), written the way the old trigger wrote them.
do $$ declare _j uuid; begin
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, payment_method)
  values (current_setting('t.cust')::uuid, 'custom', 12, '12 Harward Road, Belvedere, Harare, Zimbabwe', 400, 'direct') returning id into _j;
  perform set_config('t.job', _j::text, true);
  update public.jobs set driver_id = current_setting('t.sel')::uuid, status = 'accepted' where id = _j;
  delete from public.notifications where job_id = _j;
  insert into public.notifications (user_id, type, title, body, job_id, read) values
    (current_setting('t.sel')::uuid, 'new_job', 'New job available', '12.00m³ custom delivery to 12 Harward Road, Belvedere, Harare, Zimbabwe', _j, true),
    (current_setting('t.oth')::uuid, 'new_job', 'New job available', '12.00m³ custom delivery to 12 Harward Road, Belvedere, Harare, Zimbabwe', _j, false),
    (current_setting('t.oth')::uuid, 'job_update', 'Keep me', 'untouched: delivery to 12 Harward Road', _j, false);
end $$;
insert into _before select * from public.notifications where job_id = current_setting('t.job')::uuid;

update public.notifications n
   set body = substring(n.body from '^(.*? delivery to )') ||
              coalesce(public.coarse_place(coalesce(j.dropoff_address, j.delivery_address)), 'a nearby area')
  from public.jobs j
 where j.id = n.job_id
   and n.type = 'new_job'
   and j.driver_id is distinct from n.user_id
   and n.body ~ '^.*? delivery to '
   and n.body <> substring(n.body from '^(.*? delivery to )') ||
                 coalesce(public.coarse_place(coalesce(j.dropoff_address, j.delivery_address)), 'a nearby area');

select is((select body from public.notifications where user_id = current_setting('t.oth')::uuid and type = 'new_job' and job_id = current_setting('t.job')::uuid),
  '12.00m³ custom delivery to Belvedere, Harare', 'another driver''s notification now shows only the area');
select is((select body from public.notifications where user_id = current_setting('t.sel')::uuid and type = 'new_job' and job_id = current_setting('t.job')::uuid),
  '12.00m³ custom delivery to 12 Harward Road, Belvedere, Harare, Zimbabwe', 'the assigned driver''s notification is left alone');
select is((select body from public.notifications where type = 'job_update' and job_id = current_setting('t.job')::uuid),
  'untouched: delivery to 12 Harward Road', 'other notification types are never touched');
select is((select count(*)::int from public.notifications a join _before b using (id)
            where (a.user_id, a.type, a.title, a.job_id, a.read, a.created_at) is distinct from (b.user_id, b.type, b.title, b.job_id, b.read, b.created_at)), 0,
  'no column other than body changed on any row');
select is((select count(*)::int from public.notifications a join _before b using (id) where a.body is distinct from b.body), 1,
  'exactly one row changed');
select is((select read from public.notifications where user_id = current_setting('t.oth')::uuid and type = 'new_job' and job_id = current_setting('t.job')::uuid),
  false, 'the read flag is preserved');
select is((select count(*)::int from public.jobs where id = current_setting('t.job')::uuid and status = 'accepted' and driver_id = current_setting('t.sel')::uuid), 1,
  'the job itself is untouched');
-- idempotent: after the update, no row remains that the same statement would still change
select is((select count(*)::int from public.notifications n join public.jobs j on j.id = n.job_id
            where n.type = 'new_job' and j.driver_id is distinct from n.user_id and n.body ~ '^.*? delivery to '
              and n.body <> substring(n.body from '^(.*? delivery to )') ||
                            coalesce(public.coarse_place(coalesce(j.dropoff_address, j.delivery_address)), 'a nearby area')), 0,
  'a second run would have nothing left to change');
select ok((select count(*) from public.notifications where type = 'new_job' and body ~* 'Harward' and user_id = current_setting('t.oth')::uuid) = 0,
  'no exact street remains for the non-assigned driver');

select * from finish();
rollback;
