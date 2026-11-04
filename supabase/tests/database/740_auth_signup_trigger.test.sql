-- 0141: the sign-up trigger exists exactly once, and new-user / existing-user behaviour is right.
begin;
select plan(11);

select is((select count(*)::int from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal), 1,
  'the sign-up trigger exists once');
select is((select tgenabled::text from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created'), 'O',
  'and it is enabled');
select is((select p.proname::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgname = 'on_auth_user_created'), 'handle_new_user',
  'and it runs handle_new_user');

-- Re-running the migration's guarded block changes nothing (no duplicate, no replacement).
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal) then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
end $$;
select is((select count(*)::int from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal), 1,
  'the guarded block is a no-op when the trigger already exists');

create temp table _ids (k text, id uuid);
insert into _ids select 'cust', gen_random_uuid() union all select 'drv', gen_random_uuid() union all select 'adm', gen_random_uuid();
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', k || '.t740@test.local', '', now(), '{"provider":"email"}',
       case k when 'cust' then '{"full_name":"New Customer"}'::jsonb
              when 'drv' then '{"full_name":"New Driver","role":"driver"}'::jsonb
              else '{"full_name":"Not Admin","role":"super_admin"}'::jsonb end, now(), now()
  from _ids;

select is((select full_name from public.profiles where id = (select id from _ids where k = 'cust')), 'New Customer', 'a new customer gets a profile with their name');
select is((select string_agg(role::text, ',') from public.user_roles where user_id = (select id from _ids where k = 'cust')), 'customer', 'and only the customer role');
select is((select count(*)::int from public.driver_profiles where user_id = (select id from _ids where k = 'cust')), 0, 'and no driver profile');
select is((select string_agg(role::text, ',') from public.user_roles where user_id = (select id from _ids where k = 'drv')), 'driver', 'a driver sign-up gets the driver role');
select is((select count(*)::int from public.driver_profiles dp join public.wallets w on w.user_id = dp.user_id where dp.user_id = (select id from _ids where k = 'drv')), 1,
  'and a driver profile and a wallet (balance 0)');
select is((select string_agg(role::text, ',') from public.user_roles where user_id = (select id from _ids where k = 'adm')), 'customer',
  'asking for super_admin at sign-up only ever yields customer');
select is((select count(*)::int from public.profiles where id in (select id from _ids)), 3, 'exactly one profile per new user');

select * from finish();
rollback;
