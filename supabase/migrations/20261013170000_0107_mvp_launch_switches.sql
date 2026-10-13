-- 0107: MVP launch switches (owner decision, 2026-10-13).
--
-- Why: ConZ launches small and unregistered. The first version is "direct pay + driver
-- ConZ credit": the customer pays the driver on delivery, drivers top up credit through
-- Paynow, ConZ takes its 7% from that credit. Escrow (Con Z Pay) and withdrawals are
-- paused until the legal side is settled, and amounts are capped so any mistake stays small.
--
-- What it adds (all enforced by the DATABASE, not just hidden in the UI):
--   system_settings keys (owner/super admin can change them):
--     escrow_enabled        false  -> new jobs cannot use payment_method = 'escrow'
--     withdrawals_enabled   false  -> no new withdrawal requests
--     max_job_budget        500    -> a job budget or a bid above this is refused
--     max_wallet_balance    150    -> a top-up that would take a wallet above this is refused
--     min_topup             1      -> smallest top-up (raise to 5-10 after the owner decides)
--   launch_switches()       read-only RPC for the app to show the right screens.
--   Triggers: jobs (insert), bids (insert), wallet_withdrawal_requests (insert),
--             payments (insert, type topup), wallet_topup_requests (insert).
--
-- Not changed: commission rate, first-job-free, delivery proof, step-up, wallet crediting,
-- reconciliation, existing rows. Updates to existing jobs/bids/payments are not touched, so
-- anything already in flight keeps working. Pricing, ledger and RLS are untouched.
-- Deploy: database after Stage B (needs 0096 delivery proof for direct pay). Safe to apply
-- before the app update: the old app still works, it just gets a clear error if it offers
-- Con Z Pay. To turn escrow on later: update system_settings set value='true'::jsonb
-- where key='escrow_enabled'.
-- Rollback: drop the five triggers and launch_switches(); settings rows are harmless.

insert into public.system_settings (key, value) values
  ('escrow_enabled',      'false'::jsonb),
  ('withdrawals_enabled', 'false'::jsonb),
  ('max_job_budget',      '500'::jsonb),
  ('max_wallet_balance',  '150'::jsonb),
  ('min_topup',           '1'::jsonb)
on conflict (key) do nothing;

-- Reads one switch, falling back to a safe default if the row is missing or malformed.
create or replace function public._launch_setting_num(_key text, _default numeric)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare _v numeric;
begin
  select (value #>> '{}')::numeric into _v from public.system_settings where key = _key;
  return coalesce(_v, _default);
exception when others then
  return _default;
end $$;

create or replace function public._launch_setting_bool(_key text, _default boolean)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare _v boolean;
begin
  select (value #>> '{}')::boolean into _v from public.system_settings where key = _key;
  return coalesce(_v, _default);
exception when others then
  return _default;
end $$;

revoke all on function public._launch_setting_num(text, numeric) from public, anon, authenticated;
revoke all on function public._launch_setting_bool(text, boolean) from public, anon, authenticated;

-- What the app reads to decide which screens to show. Read-only, flags and limits only.
create or replace function public.launch_switches()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'escrowEnabled',      public._launch_setting_bool('escrow_enabled', false),
    'withdrawalsEnabled', public._launch_setting_bool('withdrawals_enabled', false),
    'maxJobBudget',       public._launch_setting_num('max_job_budget', 500),
    'maxWalletBalance',   public._launch_setting_num('max_wallet_balance', 150),
    'minTopup',           public._launch_setting_num('min_topup', 1)
  );
$$;

revoke all on function public.launch_switches() from public, anon;
grant execute on function public.launch_switches() to authenticated, service_role;

-- Jobs: no escrow while it is off; budget within the cap.
create or replace function public.tg_enforce_launch_job_limits()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare _cap numeric := public._launch_setting_num('max_job_budget', 500);
begin
  if new.payment_method = 'escrow' and not public._launch_setting_bool('escrow_enabled', false) then
    raise exception 'Con Z Pay is not available yet. Please pay the driver directly.' using errcode = 'P0001';
  end if;
  -- NaN/Infinity/over-100,000 values are left to the existing platform-limit constraints.
  if new.budget is not null and new.budget <= 100000 and new.budget > _cap then
    raise exception 'The maximum amount for a job right now is $%. Please post a smaller job or split it.', _cap::text
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists jobs_enforce_launch_limits on public.jobs;
create trigger jobs_enforce_launch_limits
  before insert on public.jobs
  for each row execute function public.tg_enforce_launch_job_limits();

-- Bids: a driver's price is held to the same cap.
create or replace function public.tg_enforce_launch_bid_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare _cap numeric := public._launch_setting_num('max_job_budget', 500);
begin
  if new.price is not null and new.price <= 100000 and new.price > _cap then
    raise exception 'The maximum amount for a job right now is $%. Please enter a lower price.', _cap::text
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists bids_enforce_launch_limit on public.bids;
create trigger bids_enforce_launch_limit
  before insert on public.bids
  for each row execute function public.tg_enforce_launch_bid_limit();

-- Withdrawals: paused while the switch is off.
create or replace function public.tg_enforce_withdrawals_paused()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public._launch_setting_bool('withdrawals_enabled', false) then
    raise exception 'Withdrawals are paused for now. Your ConZ credit is used to pay our fee on jobs. To get unused credit back, contact support.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists withdrawal_requests_enforce_paused on public.wallet_withdrawal_requests;
create trigger withdrawal_requests_enforce_paused
  before insert on public.wallet_withdrawal_requests
  for each row execute function public.tg_enforce_withdrawals_paused();

-- Top-ups (Paynow payments of type topup, and manual top-up requests): minimum and wallet cap.
create or replace function public.tg_enforce_topup_limits()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  _min numeric := public._launch_setting_num('min_topup', 1);
  _cap numeric := public._launch_setting_num('max_wallet_balance', 150);
  _bal numeric;
begin
  -- Only Paynow payments of type topup are limited (payments also holds escrow rows).
  -- jsonb is used so the same function can serve wallet_topup_requests, which has no "type".
  if tg_table_name = 'payments' then
    if coalesce(to_jsonb(new) ->> 'type', '') <> 'topup' then
      return new;
    end if;
  end if;
  -- NaN/Infinity/over-100,000 amounts are left to the existing platform-limit constraints.
  if new.amount > 100000 then
    return new;
  end if;
  if new.amount < _min then
    raise exception 'The smallest top-up is $%.', _min::text using errcode = 'P0001';
  end if;
  select coalesce(balance, 0) into _bal from public.wallets where user_id = new.user_id;
  _bal := coalesce(_bal, 0);
  if _bal + new.amount > _cap then
    raise exception 'Your ConZ credit can hold at most $%. You can add up to $% right now.',
      _cap::text, greatest(_cap - _bal, 0)::text using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists payments_enforce_topup_limits on public.payments;
create trigger payments_enforce_topup_limits
  before insert on public.payments
  for each row execute function public.tg_enforce_topup_limits();

drop trigger if exists topup_requests_enforce_limits on public.wallet_topup_requests;
create trigger topup_requests_enforce_limits
  before insert on public.wallet_topup_requests
  for each row execute function public.tg_enforce_topup_limits();

revoke all on function public.tg_enforce_launch_job_limits() from public, anon, authenticated;
revoke all on function public.tg_enforce_launch_bid_limit() from public, anon, authenticated;
revoke all on function public.tg_enforce_withdrawals_paused() from public, anon, authenticated;
revoke all on function public.tg_enforce_topup_limits() from public, anon, authenticated;
