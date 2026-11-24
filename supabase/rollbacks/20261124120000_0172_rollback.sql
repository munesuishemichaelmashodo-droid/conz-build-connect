-- Undo 0172: restore the $500 ceiling exactly as before (bodies = 0107 / 0134 / 0129, live hashes checked 24/11/2026:
-- tg_enforce_launch_job_limits fcb68a25, tg_enforce_launch_bid_limit 504befc0, launch_switches 04077d97).
-- Contains DROP: run in the Supabase SQL editor.
begin;
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

create or replace function public.launch_switches()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'escrowEnabled',      public._launch_setting_bool('escrow_enabled', false),
    'withdrawalsEnabled', public._launch_setting_bool('withdrawals_enabled', false),
    'maxJobBudget',       public._launch_setting_num('max_job_budget', 500),
    'maxWalletBalance',   public._launch_setting_num('max_wallet_balance', 150),
    'minTopup',           public._launch_setting_num('min_topup', 1),
    'promoCreditEnabled', public._launch_setting_bool('promo_credit_enabled', false),
    'promoCreditAmount',  public._launch_setting_num('promo_credit_amount', 20)
  );
$$;

create or replace function public.admin_set_launch_switch(_key text, _value jsonb, _reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _old jsonb;
  _num numeric;
  _clean jsonb;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change launch switches.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;

  if _key in ('escrow_enabled', 'withdrawals_enabled') then
    if _value is null or jsonb_typeof(_value) <> 'boolean' then
      raise exception '% must be true or false.', _key using errcode = '22023';
    end if;
    _clean := _value;
  elsif _key in ('max_job_budget', 'max_wallet_balance', 'min_topup') then
    if _value is null or jsonb_typeof(_value) <> 'number' then
      raise exception '% must be a number.', _key using errcode = '22023';
    end if;
    _num := (_value #>> '{}')::numeric;
    if _key = 'min_topup' and (_num < 0.01 or _num > 1000) then
      raise exception 'The minimum top-up must be between 0.01 and 1,000.' using errcode = '22023';
    elsif _key <> 'min_topup' and (_num < 1 or _num > 10000) then
      raise exception '% must be between 1 and 10,000.', _key using errcode = '22023';
    end if;
    _clean := to_jsonb(round(_num, 2));
  else
    raise exception 'Unknown launch switch.' using errcode = '22023';
  end if;

  select value into _old from public.system_settings where key = _key;
  insert into public.system_settings (key, value, updated_by, updated_at)
  values (_key, _clean, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();

  perform public.log_admin_action(
    _action => 'launch_switch_changed',
    _meta => jsonb_build_object('key', _key, 'value', _clean, 'previous', _old),
    _reason => btrim(_reason));
  return public.launch_switches();
end $$;

drop trigger if exists trg_jobs_large_job_alert on public.jobs;
drop function if exists public.tg_jobs_large_job_alert();
delete from public.system_settings where key = 'large_job_alert_amount';
insert into public.system_settings (key, value, updated_at) values ('max_job_budget', '500'::jsonb, now())
on conflict (key) do nothing;
delete from supabase_migrations.schema_migrations where version = '20261124120000';
commit;
