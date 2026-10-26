-- Undo 0115_roles_and_data_exposure: restores the exact production definitions of
-- 25/10/2026 (read with pg_get_functiondef and pg_policy). This re-opens S-3, S-4,
-- S-6 and S-7. Note: the Supabase MCP tool hangs on DROP; run this in the SQL editor.
begin;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r public.app_role; _requested text;
BEGIN
  INSERT INTO public.profiles(id, full_name, phone, email)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
          NEW.raw_user_meta_data->>'phone',
          NEW.email);

  _requested := NEW.raw_user_meta_data->>'role';
  r := CASE WHEN _requested = 'driver' THEN 'driver'::public.app_role
            ELSE 'customer'::public.app_role END;
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, r) ON CONFLICT DO NOTHING;

  IF r = 'driver' THEN
    INSERT INTO public.driver_profiles(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.wallets(user_id, balance) VALUES (NEW.id, 0) ON CONFLICT DO NOTHING;
  END IF;

  -- Auto-seed designated owner as super_admin + admin
  IF lower(NEW.email) = 'munesuishemichaelmashodo@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'super_admin') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.driver_profiles_guard_direct_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
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
  if _is_admin then return new; end if;

  -- self-service only: everything below this point is the driver
  -- editing their own row (RLS already enforces user_id = auth.uid())

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

drop function if exists public.admin_list_supplier_contacts();
grant select on public.suppliers to anon, authenticated;

drop policy if exists "Users read own profile" on public.profiles;
drop policy if exists "Job partners read each other" on public.profiles;
create policy "Users can insert their own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can view their own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can view profiles of active job partners" on public.profiles
  for select using (exists (
    select 1 from public.jobs
     where jobs.status = any (array['accepted'::public.job_status, 'in_progress'::public.job_status])
       and (   (jobs.customer_id = auth.uid() and jobs.driver_id = profiles.id)
            or (jobs.driver_id = auth.uid() and jobs.customer_id = profiles.id))));

alter function public.tg_sourcing_history_immutable() reset search_path;
alter function public.sourcing_transition_allowed(text, text) reset search_path;

commit;
