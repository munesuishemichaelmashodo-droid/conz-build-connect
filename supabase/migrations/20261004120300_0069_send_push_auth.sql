-- 0069 — Authenticate the send-push Edge Function (audit C4).
--
-- Security reason: send-push (verify_jwt=false) accepted {user_id,title,body}
-- from anyone and delivered branded pushes to any user — a ready-made phishing
-- channel. It is called server-to-server by the notifications trigger via
-- pg_net, which cannot attach a user JWT, so the fix is a shared secret:
--   * public.app_secrets holds push_hook_secret (readable only by service_role);
--   * tg_send_push_on_notification sends it in the x-conz-push-secret header;
--   * the redeployed function (see supabase/functions/send-push/index.ts)
--     rejects any request whose header does not match (constant-time) with 401.
--
-- The secret value is generated in-place with gen_random_bytes and never
-- appears in this migration or in git. Safe to replay (value kept on conflict).

create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
-- No policies + no client grants: only service_role (used by Edge Functions)
-- and the table owner can read it. SECURITY DEFINER triggers read it as owner.
revoke all on public.app_secrets from anon, authenticated;
grant select on public.app_secrets to service_role;

insert into public.app_secrets(key, value)
  values ('push_hook_secret', encode(gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;

create or replace function public.tg_send_push_on_notification()
returns trigger language plpgsql security definer set search_path to 'public','extensions' as $fn$
declare _secret text;
begin
  select value into _secret from public.app_secrets where key = 'push_hook_secret';
  perform net.http_post(
    url := 'https://ovwrsocjmkpiygipmrdk.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-conz-push-secret', coalesce(_secret, '')
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', COALESCE(NEW.body, ''),
      'notification_id', NEW.id,
      'job_id', NEW.job_id
    )
  );
  return NEW;
end $fn$;
