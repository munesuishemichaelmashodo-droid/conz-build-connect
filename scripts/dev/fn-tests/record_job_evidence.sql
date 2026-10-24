-- Isolated logic test for public.record_job_evidence (migration 0110).
--
-- Runs on a plain throwaway Postgres (no Supabase): minimal stand-ins for auth.uid(),
-- has_role(), storage.objects, jobs and job_evidence; then the function under test is
-- loaded from a migration file and exercised. It proves the function's own rules only:
-- no RLS, triggers or storage policies are involved. The full-stack pgTAP test is
-- supabase/tests/database/400_record_job_evidence_stage_order.test.sql.
--
--   psql -v fn_file=<file with the CREATE FUNCTION> -f scripts/dev/fn-tests/record_job_evidence.sql
-- Expected with 0110: cases 7, 9, 10, 11 ALLOWED, every other case refused, and the job's
-- photo pointers equal pickup-1.jpg / delivery-1.jpg.
\set ON_ERROR_STOP on
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade;
create schema public; create schema auth; create schema storage; create schema if not exists extensions;
create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled');
create type public.app_role as enum ('customer','driver','admin','super_admin');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.user_roles (user_id uuid, role public.app_role);
create function public.has_role(_u uuid, _r public.app_role) returns boolean language sql stable as
  $$ select exists (select 1 from public.user_roles where user_id = _u and role = _r) $$;
create table storage.objects (bucket_id text, name text);
create table public.jobs (id uuid primary key, status public.job_status, customer_id uuid, driver_id uuid,
  pickup_photo_url text, delivery_photo_url text, pickup_lat numeric, pickup_lng numeric, delivery_lat numeric, delivery_lng numeric);
create table public.job_evidence (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, storage_path text,
  uploaded_by uuid, file_size bigint, mime_type text, device_lat double precision, device_lng double precision,
  device_accuracy_m numeric, location_status text, uploaded_at timestamptz default now());
\i :fn_file

-- People and one job.  c = customer, d = driver, a = admin, x = stranger, j = job
insert into public.user_roles values ('00000000-0000-0000-0000-0000000000aa', 'admin');
insert into public.jobs (id, status, customer_id, driver_id) values
  ('00000000-0000-0000-0000-00000000000f', 'accepted', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000ca', 'cancelled', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1');
insert into storage.objects values
  ('job-proof-photos', '00000000-0000-0000-0000-00000000000f/pickup-1.jpg'),
  ('job-proof-photos', '00000000-0000-0000-0000-00000000000f/delivery-1.jpg'),
  ('job-proof-photos', '00000000-0000-0000-0000-00000000000f/delivery-2.jpg'),
  ('job-proof-photos', '00000000-0000-0000-0000-00000000000f/dispute-1.jpg'),
  ('job-proof-photos', '00000000-0000-0000-0000-0000000000ca/pickup-1.jpg');

create temp table results (n int, case_name text, outcome text);
create function pg_temp.attempt(_n int, _name text, _uid text, _job text, _kind text, _path text) returns void language plpgsql as $$
begin
  perform set_config('test.uid', _uid, false);
  begin
    perform public.record_job_evidence(_job::uuid, _kind, _path);
    insert into results values (_n, _name, 'ALLOWED');
  exception when others then
    insert into results values (_n, _name, 'refused: ' || sqlerrm);
  end;
end $$;
\set J '00000000-0000-0000-0000-00000000000f'
\set C '00000000-0000-0000-0000-0000000000c1'
\set D '00000000-0000-0000-0000-0000000000d1'
\set A '00000000-0000-0000-0000-0000000000aa'
\o /dev/null
select pg_temp.attempt(1, 'customer files a delivery photo first (made-up path)', :'C', :'J', 'delivery', :'J' || '/fake.jpg');
select pg_temp.attempt(2, 'admin files a delivery photo', :'A', :'J', 'delivery', :'J' || '/delivery-1.jpg');
select pg_temp.attempt(3, 'driver files delivery before pickup / trip start', :'D', :'J', 'delivery', :'J' || '/delivery-1.jpg');
select pg_temp.attempt(4, 'stranger files evidence', '00000000-0000-0000-0000-0000000000ee', :'J', 'pickup', :'J' || '/pickup-1.jpg');
select pg_temp.attempt(5, 'driver path outside the job folder', :'D', :'J', 'pickup', 'other-job/pickup-1.jpg');
select pg_temp.attempt(6, 'driver files a pickup photo that was never uploaded', :'D', :'J', 'pickup', :'J' || '/missing.jpg');
select pg_temp.attempt(7, 'driver files the real pickup photo', :'D', :'J', 'pickup', :'J' || '/pickup-1.jpg');
update public.jobs set status = 'in_progress' where id = :'J';   -- start_trip (needs the pickup photo)
select pg_temp.attempt(8, 'driver files a delivery photo that was never uploaded', :'D', :'J', 'delivery', :'J' || '/missing.jpg');
select pg_temp.attempt(9, 'driver files the real delivery photo', :'D', :'J', 'delivery', :'J' || '/delivery-1.jpg');
select pg_temp.attempt(10, 'driver files a second delivery photo', :'D', :'J', 'delivery', :'J' || '/delivery-2.jpg');
select pg_temp.attempt(11, 'customer files dispute evidence', :'C', :'J', 'dispute', :'J' || '/dispute-1.jpg');
select pg_temp.attempt(12, 'driver files pickup on a cancelled job', :'D', '00000000-0000-0000-0000-0000000000ca', 'pickup', '00000000-0000-0000-0000-0000000000ca/pickup-1.jpg');
\o
\pset footer off
select n, case_name, outcome from results order by n;
select 'job photo pointers' as check, pickup_photo_url, delivery_photo_url from public.jobs where id = :'J';
