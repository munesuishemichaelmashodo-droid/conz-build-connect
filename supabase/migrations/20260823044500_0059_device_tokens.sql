-- 0059: device_tokens — native push (Android/iOS) device registration
--
-- Mirrors the existing push_subscriptions table's RLS pattern exactly
-- (own insert/select/update/delete). Unlike push_subscriptions (one row
-- per browser subscription, unique by endpoint), this is unique per
-- (platform, token) so the same physical device/token can never be
-- duplicated, while a single user can freely have both an Android row
-- and an iOS row (or multiple of either) at once — no "one token per
-- user" limitation.
--
-- Deliberately NOT given its own send-push trigger: native delivery is
-- added as a second channel inside the existing send-push Edge Function
-- (triggered by trg_send_push_on_notification, already firing on every
-- notifications insert), not a duplicate notification-generation path.

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android','ios')),
  token text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, token)
);

create index device_tokens_user_id_idx on public.device_tokens(user_id) where active;

alter table public.device_tokens enable row level security;

create policy "device_tokens: own insert" on public.device_tokens
  for insert with check (auth.uid() = user_id);
create policy "device_tokens: own read" on public.device_tokens
  for select using (auth.uid() = user_id);
create policy "device_tokens: own update" on public.device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "device_tokens: own delete" on public.device_tokens
  for delete using (auth.uid() = user_id);

create trigger t_device_tokens_updated
  before update on public.device_tokens
  for each row execute function public.tg_touch_updated_at();
