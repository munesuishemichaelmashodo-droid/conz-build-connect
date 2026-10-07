-- Phase 7 / audit F6 — verified KYC cannot be silently changed; driver
-- documents are private and frozen once approved.

begin;
select plan(19);

select set_config('t.drv',   tests.create_driver('kyc', 0)::text, true);   -- verified
select set_config('t.new',   tests.create_user('applicant', array['driver'])::text, true);
select set_config('t.other', tests.create_user('snoop')::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);
insert into public.driver_profiles (user_id) values (current_setting('t.new')::uuid) on conflict do nothing;
update public.driver_profiles set national_id = '63-111111A11', national_id_url = current_setting('t.drv') || '/national_id_url-1-id.jpg'
 where user_id = current_setting('t.drv')::uuid;

-- Files owned by each driver
insert into storage.objects (bucket_id, name, owner, metadata)
values ('driver-docs', current_setting('t.drv') || '/national_id_url-1-id.jpg', current_setting('t.drv')::uuid, '{"mimetype":"image/jpeg","size":1000}'),
       ('driver-docs', current_setting('t.new') || '/selfie_url-1-me.jpg',      current_setting('t.new')::uuid, '{"mimetype":"image/jpeg","size":1000}');

-- ---------------------------------------------------------------------------
-- Profile fields
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$update public.driver_profiles set national_id_url = %L where user_id = auth.uid()$$,
                       current_setting('t.drv') || '/national_id_url-2-someone-else.jpg'),
  'Driver can submit a replacement document');
select tests.as_owner();
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.drv')::uuid), 'pending',
  'F6: changing an ID document on a verified profile forces re-verification');
select is((select verified_at from public.driver_profiles where user_id = current_setting('t.drv')::uuid), null,
  'F6: verified_at cleared');
select ok((select verification_notes like 'Documents changed after verification%' from public.driver_profiles where user_id = current_setting('t.drv')::uuid),
  'F6: reason recorded for the reviewer');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.admin')::uuid and title like 'Driver documents changed%'),
  'F6: admins notified to re-review');

-- Driver is no longer allowed to bid
select set_config('t.cust', tests.create_user('cust')::text, true);
select set_config('t.job',  tests.create_job(current_setting('t.cust')::uuid)::text, true);
select tests.login_as(current_setting('t.drv')::uuid);
select throws_ok(format($$insert into public.bids (job_id, driver_id, price, truck_id) values (%L, auth.uid(), 300, %L)$$,
                        current_setting('t.job'), tests.truck_of(current_setting('t.drv')::uuid)),
  '42501', null, 'F6: a driver pending re-review cannot bid');
select throws_ok($$update public.driver_profiles set verification_status = 'verified' where user_id = auth.uid()$$,
  '42501', null, 'Driver cannot re-verify themselves');
select throws_ok($$update public.driver_profiles set verified_at = now() where user_id = auth.uid()$$,
  '42501', null, 'Driver cannot set verified_at');

-- Every identity column triggers re-review (spot-check two more)
select tests.as_owner();
update public.driver_profiles set verification_status = 'verified', verified_at = now() where user_id = current_setting('t.drv')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
update public.driver_profiles set national_id = '63-999999Z99' where user_id = auth.uid();
select tests.as_owner();
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.drv')::uuid), 'pending',
  'F6: changing the national ID number forces re-verification');
update public.driver_profiles set verification_status = 'verified', verified_at = now() where user_id = current_setting('t.drv')::uuid;
select tests.login_as(current_setting('t.drv')::uuid);
update public.driver_profiles set git_insurance_url = auth.uid()::text || '/git-2.pdf' where user_id = auth.uid();
select tests.as_owner();
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.drv')::uuid), 'pending',
  'F6: changing a compliance document forces re-verification');

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
-- The Storage API sets storage.allow_delete_query before deleting AS THE USER
-- (RLS still applies); emulate that so the DELETE policies are what is tested.
select set_config('storage.allow_delete_query', 'true', true);
update public.driver_profiles set verification_status = 'verified', verified_at = now() where user_id = current_setting('t.drv')::uuid;

select tests.login_as(current_setting('t.drv')::uuid);
update storage.objects set metadata = '{"swapped":true}' where bucket_id = 'driver-docs' and name = current_setting('t.drv') || '/national_id_url-1-id.jpg';
delete from storage.objects where bucket_id = 'driver-docs' and name = current_setting('t.drv') || '/national_id_url-1-id.jpg';
select tests.as_owner();
select is((select metadata->>'swapped' from storage.objects where name = current_setting('t.drv') || '/national_id_url-1-id.jpg'), null,
  'F6: a verified driver cannot overwrite an approved document file');
select ok(exists(select 1 from storage.objects where name = current_setting('t.drv') || '/national_id_url-1-id.jpg'),
  'F6: a verified driver cannot delete an approved document file');

select tests.login_as(current_setting('t.drv')::uuid);
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('driver-docs', %L, auth.uid())$$,
                       current_setting('t.drv') || '/license_url-3-renewed.jpg'),
  'A verified driver can still upload a NEW file (which then triggers re-review)');
select is((select count(*)::int from storage.objects where bucket_id = 'driver-docs'), 2,
  'Driver sees only their own documents');

-- Applicant (not yet verified) may manage their own files
select tests.login_as(current_setting('t.new')::uuid);
delete from storage.objects where bucket_id = 'driver-docs' and name = current_setting('t.new') || '/selfie_url-1-me.jpg';
select tests.as_owner();
select ok(not exists(select 1 from storage.objects where name = current_setting('t.new') || '/selfie_url-1-me.jpg'),
  'An unverified applicant can replace/delete their own files');

-- Other users
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from storage.objects where bucket_id = 'driver-docs'), 0,
  'F6: other users cannot see anyone''s KYC documents');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('driver-docs', %L, auth.uid())$$,
                        current_setting('t.drv') || '/national_id_url-9-fake.jpg'),
  '42501', null, 'F6: nobody can upload into another driver''s folder');

select tests.login_as(current_setting('t.admin')::uuid);
select ok((select count(*) from storage.objects where bucket_id = 'driver-docs') >= 2, 'Admins can read documents for review');

-- Bucket limits
select tests.as_owner();
select ok((select file_size_limit is not null and 'application/pdf' = any(allowed_mime_types) and not ('text/html' = any(allowed_mime_types))
             from storage.buckets where id = 'driver-docs'),
  'F6: driver-docs has a size limit and an image/PDF-only type list');

select * from finish();
rollback;
