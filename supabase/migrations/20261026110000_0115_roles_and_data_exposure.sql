-- -----------------------------------------------------------------------------
-- 0115: no privileged role from sign-up; admins can't edit driver approval
-- directly; supplier contact details not public; profile policies consolidated;
-- fixed search_path on two functions.
--
-- PREPARED, NOT APPLIED. Needs the owner's approval before production. Contains
-- DROP POLICY (the Supabase MCP tool hangs on DROP): apply in the SQL editor.
-- Undo: supabase/rollbacks/20261026110000_0115_rollback.sql (exact production
-- definitions of 25/10/2026). Independent of 0113 and 0114.
--
-- Why (read-only checks on production, 25/10/2026):
--   S-3  handle_new_user gives super_admin + admin to one hard-coded email at sign-up,
--        before that email is confirmed. Today the two owners are provisioned through
--        user_roles + super_admin_owners (0111), which this does not touch.
--   S-7  The driver_profiles guard returns early for any admin, so an admin can set any
--        driver's verification_status, verified_at, reverify_due_at,
--        first_job_free_used, level or ratings with a direct UPDATE, skipping
--        admin_set_driver_verification's "no self-approval" check, its audit row and
--        the owner alerts. No app screen writes driver_profiles directly as an admin.
--   S-6  "Anyone can view suppliers" (every role, using true) plus table-wide SELECT for
--        anon/authenticated: anyone can read contact_phone, contact_email and notes.
--        Today no row has contact details; the app only reads suppliers(name).
--   S-4  profiles has nine policies, four duplicated across PUBLIC and authenticated.
--        Effective access (unchanged by this migration): own row read/insert/update;
--        admins read all; customers read drivers who bid on their jobs; customer and
--        driver read each other while a job is accepted or in progress; no delete;
--        anon nothing (auth.uid() is null).
--   C-1  tg_sourcing_history_immutable and sourcing_transition_allowed have no fixed
--        search_path (advisor warning).
-- -----------------------------------------------------------------------------

begin;

-- S-3: sign-up gives only customer or driver ------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE r public.app_role; _requested text;
BEGIN
  INSERT INTO public.profiles(id, full_name, phone, email)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.raw_user_meta_data->>'phone',
          NEW.email);

  -- Sign-up metadata is user-controlled: it can only ever choose driver or customer.
  -- Admin roles are granted only by a super admin (admin_grant_role, step-up) and
  -- super admin only to rows in super_admin_owners (0111).
  _requested := NEW.raw_user_meta_data->>'role';
  r := CASE WHEN _requested = 'driver' THEN 'driver'::public.app_role
            ELSE 'customer'::public.app_role END;
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, r) ON CONFLICT DO NOTHING;

  IF r = 'driver' THEN
    INSERT INTO public.driver_profiles(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.wallets(user_id, balance) VALUES (NEW.id, 0) ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

-- S-7: admins go through the audited functions ------------------------------------
-- Same as production except the admin branch: an admin editing ANOTHER driver may not
-- change approval, re-verification, the free first job, level, ratings, completed
-- jobs, the withdrawal PIN, owner or creation time directly. The audited functions
-- (admin_set_driver_verification and others) run as the owner and skip this guard.
-- An admin editing their OWN driver row follows the driver rules.
create or replace function public.driver_profiles_guard_direct_write()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  _is_admin boolean;
  _identity_changed boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this profile.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if _is_admin and old.user_id is distinct from auth.uid() then
    if new.verification_status is distinct from old.verification_status
       or new.verified_at         is distinct from old.verified_at
       or new.reverify_due_at     is distinct from old.reverify_due_at
       or new.first_job_free_used is distinct from old.first_job_free_used
       or new.level               is distinct from old.level
       or new.rating_avg          is distinct from old.rating_avg
       or new.rating_count        is distinct from old.rating_count
       or new.jobs_completed      is distinct from old.jobs_completed
       or new.withdrawal_pin_hash is distinct from old.withdrawal_pin_hash
       or new.user_id             is distinct from old.user_id
       or new.created_at          is distinct from old.created_at
    then
      raise exception 'Use the Verify screen to change a driver''s approval. Direct edits are not allowed.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- self-service: the driver editing their own row (RLS enforces user_id = auth.uid())

  if new.verification_notes is distinct from old.verification_notes
     or new.level              is distinct from old.level
     or new.rating_avg         is distinct from old.rating_avg
     or new.rating_count       is distinct from old.rating_count
     or new.jobs_completed     is distinct from old.jobs_completed
     or new.first_job_free_used is distinct from old.first_job_free_used
     or new.withdrawal_pin_hash is distinct from old.withdrawal_pin_hash
     or new.user_id            is distinct from old.user_id
     or new.created_at         is distinct from old.created_at
     or new.verified_at        is distinct from old.verified_at
     or new.reverify_due_at    is distinct from old.reverify_due_at
  then
    raise exception 'This field can only be changed by an admin or the app''s own actions.'
      using errcode = '42501';
  end if;

  -- verification_status: a driver may only (re)submit for review,
  -- never approve or reject themselves
  if new.verification_status is distinct from old.verification_status
     and new.verification_status <> 'pending'
  then
    raise exception 'Only an admin can verify or reject a driver.' using errcode = '42501';
  end if;

  -- F6: identity / document changes on an approved profile need a new review.
  _identity_changed :=
       new.national_id                is distinct from old.national_id
    or new.nationality                is distinct from old.nationality
    or new.national_id_url            is distinct from old.national_id_url
    or new.selfie_url                 is distinct from old.selfie_url
    or new.license_url                is distinct from old.license_url
    or new.operator_license_url       is distinct from old.operator_license_url
    or new.certificate_of_fitness_url is distinct from old.certificate_of_fitness_url
    or new.git_insurance_url          is distinct from old.git_insurance_url
    or new.zinara_url                 is distinct from old.zinara_url
    or new.tipper_photo_url           is distinct from old.tipper_photo_url
    or new.tipper_photo_side_url      is distinct from old.tipper_photo_side_url
    or new.tipper_photo_back_url      is distinct from old.tipper_photo_back_url;

  if _identity_changed and old.verification_status = 'verified' then
    new.verification_status := 'pending';
    new.verified_at := null;
    new.reverify_due_at := null;
    new.verification_notes := 'Documents changed after verification on ' || to_char(now(), 'YYYY-MM-DD') || ' — re-review required';
    perform public.notify_kyc_reverification(old.user_id);
  end if;

  return new;
end $function$;

-- S-6: supplier contact details for admins only -----------------------------------
revoke select on public.suppliers from anon, authenticated;
grant select (id, name, verification_status, created_at, updated_at) on public.suppliers to anon, authenticated;

create or replace function public.admin_list_supplier_contacts()
returns table (id uuid, name text, contact_phone text, contact_email text, notes text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return query select s.id, s.name, s.contact_phone, s.contact_email, s.notes
                 from public.suppliers s order by s.name;
end $$;
revoke all on function public.admin_list_supplier_contacts() from public, anon;
grant execute on function public.admin_list_supplier_contacts() to authenticated;

-- S-4: profiles policies, same access, no duplicates --------------------------------
drop policy if exists "Users can insert their own profile" on public.profiles;   -- dup of "Users insert own profile"
drop policy if exists "Users can update their own profile" on public.profiles;   -- dup of "Users update own profile"
drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);
drop policy if exists "Users can view profiles of active job partners" on public.profiles;
drop policy if exists "Job partners read each other" on public.profiles;
create policy "Job partners read each other" on public.profiles
  for select to authenticated
  using (exists (
    select 1 from public.jobs
     where jobs.status = any (array['accepted'::public.job_status, 'in_progress'::public.job_status])
       and (   (jobs.customer_id = auth.uid() and jobs.driver_id = profiles.id)
            or (jobs.driver_id = auth.uid() and jobs.customer_id = profiles.id))
  ));
-- Kept as they are: "Users insert own profile", "Users update own profile",
-- "Admins read all profiles", "Customers view bidders on own jobs".

-- C-1: fixed search_path ----------------------------------------------------------
alter function public.tg_sourcing_history_immutable() set search_path = public, pg_temp;
alter function public.sourcing_transition_allowed(text, text) set search_path = public, pg_temp;

commit;
