-- =============================================================================
-- 0077 — KYC protection after verification (audit F6)
-- =============================================================================
--
-- Problem (verified live 07/10/2026):
--   * driver_profiles_guard_direct_write froze status/level/stats but NOT the
--     identity and document columns, so a verified driver could swap their
--     national ID, selfie, licence or compliance documents and stay
--     'verified' (bidding as someone who was never checked).
--   * Storage policy "driver docs: owner rw" (ALL) let the driver overwrite or
--     delete the approved document files themselves.
--   * driver-docs and chat-media buckets had no size / type limits.
--
-- Fix:
--   1. Guard: if a VERIFIED driver changes any identity/document column, the
--      profile drops back to 'pending' (re-review), verified_at/reverify are
--      cleared, a note is recorded and admins are notified. Drivers cannot
--      bid while pending (bids policy requires 'verified').
--   2. driver-docs storage: owners can always read and upload NEW files into
--      their own folder; they can overwrite/delete files only while not
--      verified. No access to other users' folders. Admin policy unchanged.
--   3. Bucket limits (created idempotently — the local test DB has no storage
--      objects from before the 13/08 baseline):
--        driver-docs: 15 MB, images + PDF
--        chat-media : 15 MB, images + audio (voice notes)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profile guard (live body + F6 block). Remains SECURITY INVOKER (0071).
-- -----------------------------------------------------------------------------
create or replace function public.notify_kyc_reverification(_driver uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (user_id, type, title, body)
  select distinct ur.user_id, 'driver_verification', 'Driver documents changed — re-review needed',
         format('A verified driver (%s) changed identity or compliance documents and is back to pending.', _driver)
    from public.user_roles ur
   where ur.role in ('admin', 'super_admin');
$$;
revoke all on function public.notify_kyc_reverification(uuid) from public, anon;
grant execute on function public.notify_kyc_reverification(uuid) to authenticated, service_role;

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

-- -----------------------------------------------------------------------------
-- 2. Buckets (idempotent) with limits
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif',
              'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/aac','audio/x-m4a','audio/wav'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 3. driver-docs owner policies
-- -----------------------------------------------------------------------------
drop policy if exists "driver docs: owner rw" on storage.objects;
drop policy if exists "driver docs: owner read" on storage.objects;
drop policy if exists "driver docs: owner upload" on storage.objects;
drop policy if exists "driver docs: owner modify before verification" on storage.objects;
drop policy if exists "driver docs: owner delete before verification" on storage.objects;

create policy "driver docs: owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "driver docs: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "driver docs: owner modify before verification" on storage.objects
  for update to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from public.driver_profiles dp
                          where dp.user_id = auth.uid() and dp.verification_status = 'verified'))
  with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "driver docs: owner delete before verification" on storage.objects
  for delete to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text
         and not exists (select 1 from public.driver_profiles dp
                          where dp.user_id = auth.uid() and dp.verification_status = 'verified'));

-- Admin read access (exists live as "driver docs: admin all"; recreated here
-- so a fresh database has it too).
drop policy if exists "driver docs: admin all" on storage.objects;
create policy "driver docs: admin all" on storage.objects
  for all to authenticated
  using (bucket_id = 'driver-docs' and (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role)));
