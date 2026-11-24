-- Undo 0174: restores the exact 0169 bodies of require_aal2, admin_note_authenticator_check and
-- admin_set_authenticator_required (live md5s before 0174, comment lines stripped: require_aal2 9c57f886...,
-- admin_note_authenticator_check 0d781d3b..., admin_set_authenticator_required 0b78c12e...). No DROP.
begin;

create or replace function public.require_aal2()
returns void language plpgsql stable security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _amr jsonb := auth.jwt() -> 'amr';
  _latest bigint; _max integer; _google bigint; _gmax integer;
  _has_authenticator boolean := false;
  _required boolean := false;
begin
  -- 0169: when an owner has switched "authenticator required" on, Google alone is never enough.
  select exists (select 1 from public.system_settings s
                  where s.key = 'admin_authenticator_required' and s.value #>> '{}' = 'true')
    into _required;
  if _uid is not null then
    select exists (select 1 from auth.mfa_factors f
                    where f.user_id = _uid and f.status = 'verified' and f.factor_type = 'totp')
      into _has_authenticator;
  end if;

  -- (a) No authenticator on this account: a Google sign-in within the window, on an account
  --     that has Google linked (unchanged from 0111).
  if not _has_authenticator and not _required and _uid is not null and jsonb_typeof(_amr) = 'array' then
    select max((e ->> 'timestamp')::bigint) into _google
      from jsonb_array_elements(_amr) e
     where jsonb_typeof(e) = 'object'
       and e ->> 'method' = 'oauth'
       and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
    if _google is not null then
      select least(greatest(coalesce(
               (select case when (value ->> 'google_max_age_minutes') ~ '^[0-9]{1,7}$'
                            then (value ->> 'google_max_age_minutes')::integer end
                  from public.system_settings where key = 'admin_stepup'),
               720), 1), 1440)
        into _gmax;
      if to_timestamp(_google) >= now() - make_interval(mins => _gmax)
         and exists (select 1 from auth.identities i where i.user_id = _uid and i.provider = 'google')
      then
        return;
      end if;
    end if;
  end if;

  -- (b) A second factor on this sign-in, used recently enough.
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    if _has_authenticator then
      raise exception 'MFA_REQUIRED: enter the code from your authenticator app to approve this.'
        using errcode = '42501';
    end if;
    if _required then
      raise exception 'MFA_REQUIRED: set up your authenticator app first, then enter its code to approve this.'
        using errcode = '42501';
    end if;
    raise exception 'MFA_REQUIRED: sign in again with Google to approve this (or verify with your authenticator app).'
      using errcode = '42501';
  end if;
  if jsonb_typeof(_amr) = 'array' then
    select coalesce(
             (select case when (value ->> 'max_age_minutes') ~ '^[0-9]{1,3}$'
                          then (value ->> 'max_age_minutes')::integer end
                from public.system_settings where key = 'admin_stepup'),
             15)
      into _max;
    select max((e ->> 'timestamp')::bigint) into _latest
      from jsonb_array_elements(_amr) e
     where jsonb_typeof(e) = 'object'
       and e ->> 'method' in ('totp', 'webauthn', 'phone')
       and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
    if _latest is null or to_timestamp(_latest) < now() - make_interval(mins => greatest(_max, 1)) then
      raise exception 'MFA_REQUIRED: your verification has expired. Enter a new code from your authenticator app.'
        using errcode = '42501';
    end if;
  end if;
end $$;
revoke all on function public.require_aal2() from public, anon;
grant execute on function public.require_aal2() to authenticated, service_role;

create or replace function public.admin_note_authenticator_check()
returns timestamptz language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _amr jsonb := auth.jwt() -> 'amr'; _latest bigint;
begin
  if _me is null or not (public.has_role(_me, 'admin') or public.has_role(_me, 'super_admin')) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' or jsonb_typeof(_amr) <> 'array' then
    raise exception 'MFA_REQUIRED: enter the code from your authenticator app.' using errcode = '42501';
  end if;
  select max((e ->> 'timestamp')::bigint) into _latest
    from jsonb_array_elements(_amr) e
   where jsonb_typeof(e) = 'object' and e ->> 'method' = 'totp' and (e ->> 'timestamp') ~ '^[0-9]{1,12}$';
  if _latest is null or to_timestamp(_latest) < now() - interval '5 minutes' then
    raise exception 'MFA_REQUIRED: enter a new code from your authenticator app.' using errcode = '42501';
  end if;
  insert into public.admin_authenticator_checks (user_id, verified_at) values (_me, to_timestamp(_latest))
  on conflict (user_id) do update set verified_at = greatest(public.admin_authenticator_checks.verified_at, excluded.verified_at);
  return to_timestamp(_latest);
end $$;
revoke all on function public.admin_note_authenticator_check() from public, anon;
grant execute on function public.admin_note_authenticator_check() to authenticated;

create or replace function public.admin_set_authenticator_required(_required boolean, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _me uuid := auth.uid(); _old boolean;
begin
  if _me is null or not public.has_role(_me, 'super_admin') then
    raise exception 'Only super admins can change this' using errcode = '42501';
  end if;
  if _required is null then
    raise exception 'Say whether the authenticator is required' using errcode = '22023';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'A written reason (at least 5 characters) is required' using errcode = '22023';
  end if;
  if _required and not exists (select 1 from auth.mfa_factors f
                                where f.user_id = _me and f.status = 'verified' and f.factor_type = 'totp') then
    raise exception 'Set up your own authenticator app first, so you are not locked out.' using errcode = '22023';
  end if;
  perform public.require_aal2();
  select exists (select 1 from public.system_settings s
                  where s.key = 'admin_authenticator_required' and s.value #>> '{}' = 'true') into _old;
  insert into public.system_settings (key, value, updated_by, updated_at)
  values ('admin_authenticator_required', to_jsonb(_required), _me, now())
  on conflict (key) do update set value = excluded.value, updated_by = _me, updated_at = now();
  perform public.log_admin_action('authenticator_required_changed',
            jsonb_build_object('required', _required, 'previous', _old), btrim(_reason));
  return jsonb_build_object('required', _required);
end $$;
revoke all on function public.admin_set_authenticator_required(boolean, text) from public, anon;
grant execute on function public.admin_set_authenticator_required(boolean, text) to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261124140000';
commit;
