-- -----------------------------------------------------------------------------
-- 0177: drivers' marketplace accounts at the payment provider (Linkwa sub-merchants), and the rule that only a
-- driver with an approved account can be given a provider-paid job once marketplace settlement is switched on.
--
-- Model (owner decision 25/11/2026): customer -> Linkwa -> Linkwa settles 93% to the driver's own receiving account
-- and 7% to ConZ. ConZ never holds the driver's money. ConZ keeps a record of each driver's provider account:
--   * provider_account_id: the provider's identifier for the driver (Linkwa sub-merchant id);
--   * kyc_status: not_started -> submitted -> pending_review -> approved | rejected; approved <-> suspended;
--   * the receiving account TYPE and a MASKED number only (e.g. "ecocash ••••7707"). Identity documents stay with the
--     provider; ConZ stores none of them here.
-- Written only by the server (service role) when the provider reports something, and by admins to suspend or
-- reinstate. Every change is kept in driver_provider_account_events (append-only).
--
-- The provider API calls that register a driver and report KYC are NOT here: Linkwa's sub-merchant endpoints have
-- not been supplied yet (docs/payments/LINKWA-MARKETPLACE-CHECKLIST.md, B1). This file only stores and checks what
-- the provider reports.
--
-- Switch: system_settings.provider_marketplace_settlement (default false). While false nothing changes. When true,
-- accepting a provider-paid job requires driver_provider_account_ready(driver).
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261125110000_0177_rollback.sql.
-- Tests: supabase/tests/database/1110_driver_provider_accounts.test.sql
-- -----------------------------------------------------------------------------

insert into public.system_settings (key, value, updated_at)
values ('provider_marketplace_settlement', 'false'::jsonb, now())
on conflict (key) do nothing;

create table if not exists public.driver_provider_accounts (
  driver_id                     uuid not null references public.driver_profiles(user_id),
  provider                      text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_account_id           text check (provider_account_id is null or (length(provider_account_id) between 1 and 200
                                             and provider_account_id !~ '[[:cntrl:][:space:]]')),
  kyc_status                    text not null default 'not_started'
                                  check (kyc_status in ('not_started', 'submitted', 'pending_review', 'approved', 'rejected', 'suspended')),
  receiving_account_type        text check (receiving_account_type is null
                                  or receiving_account_type in ('ecocash', 'onemoney', 'innbucks', 'smilecash', 'bank', 'other')),
  receiving_account_masked      text check (receiving_account_masked is null or (length(receiving_account_masked) between 2 and 40
                                  and receiving_account_masked !~ '[0-9]{5,}')),   -- never a full number
  receiving_account_verified_at timestamptz,
  status_reason                 text check (status_reason is null or length(status_reason) <= 500),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  primary key (driver_id, provider)
);
create unique index if not exists driver_provider_accounts_provider_account_key
  on public.driver_provider_accounts (provider, provider_account_id) where provider_account_id is not null;

create table if not exists public.driver_provider_account_events (
  id          bigint generated always as identity primary key,
  driver_id   uuid not null,
  provider    text not null,
  from_status text,
  to_status   text not null,
  source      text not null check (source in ('provider', 'admin')),
  actor       uuid,
  detail      text check (detail is null or length(detail) <= 500),
  created_at  timestamptz not null default now()
);

create or replace function public.driver_provider_account_events_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Provider account history is append-only.' using errcode = '42501';
end $$;
revoke all on function public.driver_provider_account_events_append_only() from public, anon, authenticated;
create or replace trigger trg_driver_provider_account_events_append_only
  before update or delete on public.driver_provider_account_events
  for each row execute function public.driver_provider_account_events_append_only();

alter table public.driver_provider_accounts enable row level security;
alter table public.driver_provider_account_events enable row level security;
revoke all on public.driver_provider_accounts, public.driver_provider_account_events from public, anon, authenticated;
grant select on public.driver_provider_accounts, public.driver_provider_account_events to authenticated;
grant all on public.driver_provider_accounts, public.driver_provider_account_events to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'driver_provider_accounts' and policyname = 'driver_provider_accounts_read') then
    create policy driver_provider_accounts_read on public.driver_provider_accounts for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'driver_provider_account_events' and policyname = 'driver_provider_account_events_read') then
    create policy driver_provider_account_events_read on public.driver_provider_account_events for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

-- Ready to be given a provider-paid job and to be settled: verified ConZ driver + approved provider account with a
-- verified receiving account.
create or replace function public.driver_provider_account_ready(_driver uuid, _provider text default null)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.is_verified_driver(_driver), false)
     and exists (
       select 1 from public.driver_provider_accounts a
        where a.driver_id = _driver
          and a.provider = coalesce(_provider, (select value #>> '{}' from public.system_settings where key = 'payment_provider'))
          and a.kyc_status = 'approved'
          and a.provider_account_id is not null
          and a.receiving_account_verified_at is not null)
$$;
revoke all on function public.driver_provider_account_ready(uuid, text) from public, anon;
grant execute on function public.driver_provider_account_ready(uuid, text) to authenticated, service_role;

-- What the provider reported about a driver (service role only: called by the server after it verified the
-- provider's message or status answer). Allowed transitions only; identifiers are write-once.
create or replace function public.provider_record_driver_account(
  _driver uuid, _provider text, _provider_account_id text, _kyc_status text,
  _receiving_account_type text default null, _receiving_account_masked text default null,
  _receiving_account_verified boolean default false, _detail text default null)
returns public.driver_provider_accounts
language plpgsql security definer set search_path to 'public' as $$
declare _a public.driver_provider_accounts; _from text;
begin
  if not exists (select 1 from public.driver_profiles where user_id = _driver) then
    raise exception 'Driver profile not found';
  end if;
  if _kyc_status not in ('submitted', 'pending_review', 'approved', 'rejected', 'suspended') then
    raise exception 'Unknown KYC status %', _kyc_status;
  end if;

  insert into public.driver_provider_accounts (driver_id, provider) values (_driver, _provider)
  on conflict (driver_id, provider) do nothing;
  select * into _a from public.driver_provider_accounts where driver_id = _driver and provider = _provider for update;
  _from := _a.kyc_status;

  if _a.provider_account_id is not null and _provider_account_id is not null and _provider_account_id <> _a.provider_account_id then
    raise exception 'This driver already has a different % account; change it through the provider''s verified process', _provider;
  end if;
  if _kyc_status = 'approved' and coalesce(_provider_account_id, _a.provider_account_id) is null then
    raise exception 'An approved account needs the provider''s account identifier';
  end if;

  update public.driver_provider_accounts
     set provider_account_id = coalesce(provider_account_id, nullif(btrim(_provider_account_id), '')),
         kyc_status = _kyc_status,
         receiving_account_type = coalesce(_receiving_account_type, receiving_account_type),
         receiving_account_masked = coalesce(_receiving_account_masked, receiving_account_masked),
         -- a NEW receiving account is unverified until the provider says so
         receiving_account_verified_at = case
           when _receiving_account_masked is not null and _receiving_account_masked is distinct from receiving_account_masked
             then case when _receiving_account_verified then now() else null end
           when _receiving_account_verified then coalesce(receiving_account_verified_at, now())
           else receiving_account_verified_at end,
         status_reason = _detail,
         updated_at = now()
   where driver_id = _driver and provider = _provider
  returning * into _a;

  insert into public.driver_provider_account_events (driver_id, provider, from_status, to_status, source, detail)
  values (_driver, _provider, _from, _kyc_status, 'provider',
          concat_ws('; ', _detail, case when _receiving_account_masked is not null
                                        then 'receiving account ' || coalesce(_receiving_account_type, '?') || ' ' || _receiving_account_masked end));
  return _a;
end $$;
revoke all on function public.provider_record_driver_account(uuid, text, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.provider_record_driver_account(uuid, text, text, text, text, text, boolean, text) to service_role;

-- Admin: suspend (or reinstate to approved) a driver's provider account. Step-up and a reason; audited.
create or replace function public.admin_set_driver_provider_account_suspended(_driver uuid, _provider text, _suspend boolean, _reason text)
returns public.driver_provider_accounts
language plpgsql security definer set search_path to 'public' as $$
declare _a public.driver_provider_accounts; _to text;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'A reason of at least 5 characters is required'; end if;
  select * into _a from public.driver_provider_accounts where driver_id = _driver and provider = _provider for update;
  if not found then raise exception 'No % account for this driver', _provider; end if;
  if _suspend then
    _to := 'suspended';
  elsif _a.kyc_status = 'suspended' and _a.provider_account_id is not null then
    _to := 'approved';
  else
    raise exception 'Only a suspended account can be reinstated';
  end if;
  update public.driver_provider_accounts set kyc_status = _to, status_reason = _reason, updated_at = now()
   where driver_id = _driver and provider = _provider returning * into _a;
  insert into public.driver_provider_account_events (driver_id, provider, from_status, to_status, source, actor, detail)
  values (_driver, _provider, case when _suspend then 'approved' else 'suspended' end, _to, 'admin', auth.uid(), _reason);
  insert into public.admin_audit_log (actor_id, action, target_user_id, reason, meta)
  values (auth.uid(), case when _suspend then 'provider_account_suspended' else 'provider_account_reinstated' end, _driver, _reason,
          jsonb_build_object('provider', _provider));
  return _a;
end $$;
revoke all on function public.admin_set_driver_provider_account_suspended(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_set_driver_provider_account_suspended(uuid, text, boolean, text) to authenticated;

-- The gate: with marketplace settlement on, a provider-paid job is only given to a ready driver.
create or replace function public.tg_jobs_provider_driver_ready()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.payment_method = 'provider' and new.driver_id is not null
     and new.status in ('accepted', 'in_progress')
     and (old.driver_id is distinct from new.driver_id or old.status is distinct from new.status)
     and coalesce((select (value #>> '{}')::boolean from public.system_settings where key = 'provider_marketplace_settlement'), false)
     and not public.driver_provider_account_ready(new.driver_id)
  then
    raise exception 'This driver cannot take online-paid jobs yet: their payout account is not approved.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.tg_jobs_provider_driver_ready() from public, anon, authenticated;
create or replace trigger trg_jobs_provider_driver_ready
  before update of status, driver_id on public.jobs
  for each row execute function public.tg_jobs_provider_driver_ready();
