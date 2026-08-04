-- Closes the same class of bug fixed on `jobs` in 0008/0009: RLS policies
-- restrict which ROW a client can touch, not which COLUMN. Both `bids` and
-- `driver_profiles` had UPDATE policies with no column restriction, letting
-- a client bypass the app's RPCs entirely via a direct PostgREST call.

-- bids: status must only ever change through accept_bid().
create or replace function public.bids_guard_direct_write()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  _is_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this bid.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then return new; end if;

  if new.status     is distinct from old.status
     or new.job_id    is distinct from old.job_id
     or new.driver_id is distinct from old.driver_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A bid''s status can only be changed by accepting it in the app.'
      using errcode = '42501';
  end if;

  if old.driver_id = auth.uid() then
    if old.status <> 'pending' then
      raise exception 'This bid has already been decided and can no longer be edited.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Not authorised to update this bid.' using errcode = '42501';
end $function$;

drop trigger if exists trg_bids_guard_direct_write on public.bids;
create trigger trg_bids_guard_direct_write
before update on public.bids
for each row execute function public.bids_guard_direct_write();

-- driver_profiles: a driver could otherwise self-verify or inflate their own stats.
create or replace function public.driver_profiles_guard_direct_write()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  _is_admin boolean;
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

  if new.verification_notes is distinct from old.verification_notes
     or new.level              is distinct from old.level
     or new.rating_avg         is distinct from old.rating_avg
     or new.rating_count       is distinct from old.rating_count
     or new.jobs_completed     is distinct from old.jobs_completed
     or new.first_job_free_used is distinct from old.first_job_free_used
     or new.withdrawal_pin_hash is distinct from old.withdrawal_pin_hash
     or new.user_id            is distinct from old.user_id
     or new.created_at         is distinct from old.created_at
  then
    raise exception 'This field can only be changed by an admin or the app''s own actions.'
      using errcode = '42501';
  end if;

  if new.verification_status is distinct from old.verification_status
     and new.verification_status <> 'pending'
  then
    raise exception 'Only an admin can verify or reject a driver.' using errcode = '42501';
  end if;

  return new;
end $function$;

drop trigger if exists trg_driver_profiles_guard_direct_write on public.driver_profiles;
create trigger trg_driver_profiles_guard_direct_write
before update on public.driver_profiles
for each row execute function public.driver_profiles_guard_direct_write();
