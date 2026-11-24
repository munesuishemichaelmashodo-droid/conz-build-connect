-- -----------------------------------------------------------------------------
-- 0172: remove the fixed $500 job and offer ceiling (owner decision 24/11/2026).
--
-- Before: tg_enforce_launch_job_limits refused a job budget above system_settings.max_job_budget ($500) and
-- tg_enforce_launch_bid_limit refused an offer above it, so trips beyond ~411 km (transport-only pricing) could
-- not be booked or offered. launch_switches() reported it and the (unapplied) 0129 setter could change it.
--
-- After: no ceiling. Kept (unchanged): the platform limits (jobs.budget, jobs.final_price, bids.price and
-- bids.customer_counter_price must be > 0 and <= $100,000; is_valid_money in every money function), the price
-- guide ranges (tg_validate_job_budget / tg_validate_transport_job), the escrow switch check, verified-driver and
-- one-active-job rules. New operational control instead of a ceiling: admins are told about any job whose budget
-- or agreed fare is at least system_settings.large_job_alert_amount ($1,000 by default). It never blocks.
--
-- No DROP. The bid trigger is kept with a body that only passes rows through (removing it would need DROP).
-- Order on production: apply 0129 first (if not yet applied), then this file.
-- Undo: supabase/rollbacks/20261124120000_0172_rollback.sql (restores the exact previous bodies and the $500 row).
-- -----------------------------------------------------------------------------

create or replace function public.tg_enforce_launch_job_limits()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.payment_method = 'escrow' and not public._launch_setting_bool('escrow_enabled', false) then
    raise exception 'Con Z Pay is not available yet. Please pay the driver directly.' using errcode = 'P0001';
  end if;
  -- (0172) No job ceiling. NaN/Infinity/over-100,000 values are refused by the platform-limit constraints.
  return new;
end $$;

-- (0172) The offer ceiling is gone; offers keep the $100,000 platform limit (bids_price_valid).
create or replace function public.tg_enforce_launch_bid_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  return new;
end $$;

create or replace function public.launch_switches()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'escrowEnabled',      public._launch_setting_bool('escrow_enabled', false),
    'withdrawalsEnabled', public._launch_setting_bool('withdrawals_enabled', false),
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
  elsif _key in ('max_wallet_balance', 'min_topup') then
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

-- Operational control: tell admins about large jobs (never blocks).
insert into public.system_settings (key, value, updated_at) values ('large_job_alert_amount', '1000'::jsonb, now())
on conflict (key) do nothing;

create or replace function public.tg_jobs_large_job_alert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _limit numeric := public._launch_setting_num('large_job_alert_amount', 1000); _amt numeric;
begin
  if tg_op = 'INSERT' then
    _amt := new.budget;
  elsif new.final_price is distinct from old.final_price then
    _amt := new.final_price;
  end if;
  if _amt is not null and _limit > 0 and _amt >= _limit then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'large_job', 'Large job to review',
           format('A job of $%s was %s. No action is needed unless something looks wrong.', _amt,
                  case when tg_op = 'INSERT' then 'posted' else 'agreed' end),
           new.id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;
  return new;
end $$;
revoke all on function public.tg_jobs_large_job_alert() from public, anon, authenticated;
create or replace trigger trg_jobs_large_job_alert
  after insert or update of final_price on public.jobs for each row execute function public.tg_jobs_large_job_alert();

delete from public.system_settings where key = 'max_job_budget';

-- Same grants as 0129 (in case 0129 was never applied, this statement creates the setter).
revoke all on function public.admin_set_launch_switch(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_launch_switch(text, jsonb, text) to authenticated;
