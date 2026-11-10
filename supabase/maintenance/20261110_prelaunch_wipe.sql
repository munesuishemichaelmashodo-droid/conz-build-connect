-- Pre-launch wipe of test data (owner approved 10/11/2026). NOT run by any tool: the owner runs it.
--
-- HOW: Supabase Dashboard > project conz-build-connect > SQL Editor > paste this whole file > Run.
-- It is one all-or-nothing step. If any check fails it stops with an error and nothing is changed.
--
-- BEFORE: a snapshot of every public table plus the sign-in accounts was taken on 10/11/2026 into the
-- schema backup_20261110 (71 tables; not reachable by the app). The script refuses to run if that
-- snapshot is missing or does not match.
--
-- REMOVES: every row in every public table except the kept list below, and every sign-in account
-- except the two owner super admins.
-- KEEPS: the two owner accounts (wallets and test stats set to zero), prices, suppliers and pickup
-- places, settings, the owner list, app secrets.
-- DOES NOT TOUCH: stored files (Storage > driver-docs, job-proof-photos, chat-media). Delete those in
-- the Storage screen; in driver-docs leave the two owners' folders.
--
-- AFTER: the last line shows the result. Expect accounts 2, profiles 2, wallets 2, jobs 0, payments 0.
do $wipe$
declare
  owners uuid[] := array['ddc5770c-62ee-464a-9030-6c8091ef7065','eb069a4d-42bc-43eb-aa99-d8345ff90db9']::uuid[];
  keep text[] := array['system_settings','material_prices','material_price_buckets','small_load_settings','material_supply_locations','suppliers','supply_research_candidates','super_admin_owners','app_secrets','user_roles','profiles','driver_profiles','wallets'];
  t text;
  before_counts jsonb := '{}'::jsonb;
  n bigint;
begin
  if (select count(*) from public.super_admin_owners where user_id = any(owners)) <> 2 then
    raise exception 'owners not both present in super_admin_owners';
  end if;
  if to_regclass('backup_20261110.jobs') is null then
    raise exception 'snapshot schema backup_20261110 is missing: aborting';
  end if;
  if (select count(*) from backup_20261110.jobs) <> (select count(*) from public.jobs) then
    raise exception 'snapshot does not match: aborting';
  end if;
  foreach t in array array['system_settings','material_prices','material_price_buckets','small_load_settings','material_supply_locations','suppliers','supply_research_candidates','super_admin_owners','app_secrets'] loop
    execute format('select count(*) from public.%I', t) into n;
    before_counts := before_counts || jsonb_build_object(t, n);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind = 'r' and not c.relispartition and c.relname <> all(keep)
           order by c.relname loop
    execute format('truncate table public.%I restart identity cascade', t);
  end loop;
  delete from auth.users where id <> all(owners);
  update public.wallets set balance = 0, held = 0, promo_balance = 0, withdrawal_reserved = 0 where user_id = any(owners);
  update public.driver_profiles set jobs_completed = 0, rating_avg = 0, rating_count = 0 where user_id = any(owners);
  foreach t in array array['system_settings','material_prices','material_price_buckets','small_load_settings','material_supply_locations','suppliers','supply_research_candidates','super_admin_owners','app_secrets'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n <> (before_counts ->> t)::bigint then
      raise exception 'kept table % changed: % -> %', t, before_counts ->> t, n;
    end if;
  end loop;
  if (select count(*) from auth.users) <> 2 then raise exception 'auth.users not 2'; end if;
  if (select count(*) from public.profiles) <> 2 then raise exception 'profiles not 2'; end if;
  if (select count(*) from public.user_roles where user_id <> all(owners)) <> 0 then raise exception 'stray roles'; end if;
  if (select count(*) from public.wallets) <> 2 then raise exception 'wallets not 2'; end if;
end
$wipe$;

select (select count(*) from auth.users) as accounts, (select count(*) from public.profiles) as profiles,
       (select count(*) from public.wallets) as wallets, (select count(*) from public.jobs) as jobs,
       (select count(*) from public.payments) as payments;
