-- STAGING ONLY (project conz-staging, fpckydgssuefzzxivvig). NEVER run on production (ovwrsocjmkpiygipmrdk).
-- Read-only inventory of the accounts used in the Linkwa sandbox test (25/11/2026), to establish their pre-test state
-- before anything is changed. Production was checked on 27/11: the owner's live account is unaffected and
-- websterngaatendwe5@gmail.com does not exist there.
--
-- Evidence so far (docs on the closed Linkwa branch): staging was rebuilt EMPTY from the repository on 25/11
-- (148 migrations, no users); the test customer and test driver then signed up on the test site; the driver was
-- approved on staging; a $340 job was paid through the Linkwa sandbox and settled (provider payment, driver payable,
-- ledger lines). If step 1 confirms both accounts were created on or after the rebuild, their pre-test state is
-- "no account on staging", and restoring it means removing them and their test rows (owner approval needed).
--
-- Step 0 (refuse to run on production):
do $$ begin
  if current_database() is null or exists (select 1 from public.system_settings where key = 'paynow_mode' and value = '"live"'::jsonb)
  then raise exception 'Refusing: this looks like production.'; end if;
end $$;

-- Step 1: the accounts and when they were created (compare with the rebuild time in supabase_migrations).
select u.id, u.email, u.created_at, u.last_sign_in_at,
       (select min(inserted_at) from supabase_migrations.schema_migrations) as staging_rebuilt_at
  from auth.users u
 where lower(u.email) in ('ngaatendwew@gmail.com', 'ngaatendwe@gmail.com', 'websterngaatendwe5@gmail.com');

-- Step 2: every row tied to them, per table (counts only).
with u as (select id from auth.users where lower(email) in ('ngaatendwew@gmail.com', 'ngaatendwe@gmail.com', 'websterngaatendwe5@gmail.com'))
select 'profiles' t, count(*) from public.profiles where id in (select id from u)
union all select 'user_roles', count(*) from public.user_roles where user_id in (select id from u)
union all select 'driver_profiles', count(*) from public.driver_profiles where user_id in (select id from u)
union all select 'trucks', count(*) from public.trucks where driver_id in (select id from u)
union all select 'jobs', count(*) from public.jobs where customer_id in (select id from u) or driver_id in (select id from u)
union all select 'payments', count(*) from public.payments where user_id in (select id from u)
union all select 'wallets', count(*) from public.wallets where user_id in (select id from u)
union all select 'wallet_transactions', count(*) from public.wallet_transactions where user_id in (select id from u)
union all select 'notifications', count(*) from public.notifications where user_id in (select id from u);
-- Provider tables from the Linkwa branch (0175/0177) may exist on staging; inspect them by hand if present:
--   select to_regclass('public.driver_provider_accounts'), to_regclass('public.driver_payables'), to_regclass('public.provider_payment_links');

-- Step 3 (NOT included here): the change itself is written only after the owner approves it, based on steps 1-2.
