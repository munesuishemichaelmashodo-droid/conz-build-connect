-- 0122 — admin sign-in alerts: not to the person who signed in, and not repeated (owner report 27/10/2026)
--
-- 0111 alerts the owners (super_admin_owners) whenever an admin account signs in. Checked live 27/10: all 32
-- alerts went to the 2 owners only (no customer or driver ever received one), but 14 of them told an owner
-- about their OWN sign-in, and repeated sign-ins alerted again each time. The alert exists to catch someone
-- else using an admin account, so:
--   * the person who signed in is never alerted about themselves;
--   * at most one alert per admin per 30 minutes (a fresh session right after another adds nothing).
-- Admin-action alerts (tg_alert_admin_action) are unchanged. No table or policy changes.
-- Undo: supabase/rollbacks/20261027130000_0122_rollback.sql (restores the 0111 function).

create or replace function public.tg_alert_admin_signin()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _name text; _body_prefix text;
begin
  begin
    if exists (select 1 from public.user_roles r
                where r.user_id = new.user_id and r.role in ('admin', 'super_admin')) then
      select coalesce(nullif(trim(p.full_name), ''), 'An admin') into _name
        from public.profiles p where p.id = new.user_id;
      _name := coalesce(_name, 'An admin');
      _body_prefix := _name || ' signed in to Con Z admin';

      -- One alert per admin per 30 minutes.
      if exists (select 1 from public.notifications n
                  where n.type = 'admin_signin' and n.created_at > now() - interval '30 minutes'
                    and n.body like _body_prefix || ' at %') then
        return new;
      end if;

      insert into public.notifications (user_id, type, title, body)
      select o.user_id, 'admin_signin', 'Admin sign-in',
             _body_prefix || ' at ' || to_char(now() at time zone 'Africa/Harare', 'DD Mon HH24:MI')
               || ' (Harare time). If this was not them, change the password and tell the other owner.'
        from public.super_admin_owners o
        join public.user_roles r on r.user_id = o.user_id and r.role = 'super_admin'
       where o.user_id <> new.user_id;          -- never tell someone about their own sign-in
    end if;
  exception when others then
    -- An alert must never stop someone signing in.
    raise warning 'admin sign-in alert failed: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.tg_alert_admin_signin() from public, anon, authenticated;
