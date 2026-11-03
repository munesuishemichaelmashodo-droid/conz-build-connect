-- Undo 0122: restore the 0111 admin sign-in alert (alerts every owner, including the one who signed in).
create or replace function public.tg_alert_admin_signin()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _name text;
begin
  begin
    if exists (select 1 from public.user_roles r
                where r.user_id = new.user_id and r.role in ('admin', 'super_admin')) then
      select coalesce(nullif(trim(p.full_name), ''), 'An admin') into _name
        from public.profiles p where p.id = new.user_id;
      perform public.notify_owners(
        'admin_signin',
        'Admin sign-in',
        coalesce(_name, 'An admin') || ' signed in to Con Z admin at '
          || to_char(now() at time zone 'Africa/Harare', 'DD Mon HH24:MI') || ' (Harare time). If this was not them, change the password and tell the other owner.');
    end if;
  exception when others then
    -- An alert must never stop someone signing in.
    raise warning 'admin sign-in alert failed: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_alert_admin_signin() from public, anon, authenticated;
