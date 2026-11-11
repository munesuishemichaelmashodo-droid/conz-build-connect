-- -----------------------------------------------------------------------------
-- 0134: one-time promotional commission credit (non-cash).
--
-- Wallet buckets after this migration (nothing is merged with anything else):
--   wallets.balance             deposited cash (+ promo funds only while reserved, see below)
--   wallets.promo_balance       promotional commission credit, NEW
--   wallets.held                reserved commission (existing)
--   wallets.withdrawal_reserved pending withdrawals (existing)
--   platform_ledger             earned ConZ commission (existing)
--
-- Rules (founder, 03/11): $20 one-time credit per driver; non-cash, non-withdrawable, non-transferable,
-- no expiry, usable only for commission. If released from a reservation it returns to the promo bucket,
-- never to cash.
--
-- How it works without a second commission engine: when a commission reservation is made
-- (hold_job_commission), the promo part moves into balance AS RESERVED FUNDS (a ledger line), so
-- available cash (balance - held - withdrawal_reserved) is unchanged and cannot be withdrawn. Settlement
-- (settle_direct_pay_job / escrow release) is untouched: it charges the reserved amount from balance.
-- If the reservation is released (cancellation), release_job_commission moves the same promo amount back
-- out of balance into promo_balance. Promo is used first, then cash.
--
-- Safe by default: nothing is granted until system_settings.promo_credit_enabled = true (default false).
-- Existing drivers are NOT granted anything automatically (admin_grant_promo_credit is available).
-- Requires 0113 to be applied first (apply 0113, then 0134). No DROP. Corrected 09/11 (finding M4: ledger lines on reserve and release; owner decision: replaces first-job-free via activate_promo_credit_program(), a separate service-role step). Undo: supabase/rollbacks/20261103160000_0134_rollback.sql
-- -----------------------------------------------------------------------------

begin;

insert into public.system_settings (key, value) values
  ('promo_credit_enabled', 'false'::jsonb),
  ('promo_credit_amount', '20'::jsonb)
on conflict (key) do nothing;

alter table public.wallets add column if not exists promo_balance numeric(12, 2) not null default 0
  check (promo_balance >= 0 and promo_balance <= 100000);
alter table public.jobs add column if not exists held_commission_promo numeric(12, 2) not null default 0
  check (held_commission_promo >= 0);

create table if not exists public.promo_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  amount numeric(12, 2) not null check (amount <> 0),
  kind text not null check (kind in ('grant', 'reserve', 'release')),
  job_id uuid references public.jobs (id),
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (kind <> 'grant' or (amount > 0 and job_id is null)),
  check (kind <> 'reserve' or (amount < 0 and job_id is not null)),
  check (kind <> 'release' or (amount > 0 and job_id is not null))
);
create unique index if not exists promo_one_grant_per_driver on public.promo_credit_ledger (user_id) where kind = 'grant';
create unique index if not exists promo_one_reserve_per_job on public.promo_credit_ledger (job_id) where kind = 'reserve';
create unique index if not exists promo_one_release_per_job on public.promo_credit_ledger (job_id) where kind = 'release';

create or replace trigger trg_promo_credit_ledger_immutable
  before update or delete on public.promo_credit_ledger
  for each row execute function public.append_only_guard();

alter table public.promo_credit_ledger enable row level security;
revoke all on public.promo_credit_ledger from public, anon, authenticated;
grant select on public.promo_credit_ledger to authenticated;
create policy "Users read own promo credit" on public.promo_credit_ledger for select to authenticated using (user_id = auth.uid());
create policy "Admins read promo credit" on public.promo_credit_ledger for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Reservation: promo first, then cash --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hold_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _amt  numeric;
  _promo numeric;
  _bal numeric;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
  then
    raise exception 'Not authorised to hold commission on this job.' using errcode = '42501';
  end if;

  if _job.held_commission is not null then
    return _job.held_commission;             -- already reserved
  end if;

  -- first job free: nothing to reserve
  if not coalesce(
       (select first_job_free_used from public.driver_profiles
         where user_id = _job.driver_id), false) then
    update public.jobs set held_commission = 0 where id = _job_id;
    return 0;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  if not public.is_valid_money(coalesce(_job.final_price, _job.budget)) then
    raise exception 'Job % has an invalid price; commission cannot be reserved', _job_id;
  end if;

  _amt := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  -- (0134) promotional credit is spent first; it becomes reserved funds for this job only.
  select least(_amt, coalesce(promo_balance, 0)) into _promo
    from public.wallets where user_id = _job.driver_id for update;
  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;
  _promo := coalesce(_promo, 0);

  if _promo > 0 then
    update public.wallets
       set promo_balance = promo_balance - _promo, balance = balance + _promo, updated_at = now()
     where user_id = _job.driver_id returning balance into _bal;
    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note)
    values (_job.driver_id, 'adjustment', _promo, _bal, _job_id, 'Promotional credit reserved for commission (not cash)');
    insert into public.promo_credit_ledger (user_id, amount, kind, job_id, note)
    values (_job.driver_id, -_promo, 'reserve', _job_id, 'Reserved for the commission on this job');
    -- (M4) The promo funds are now inside the wallet balance as reserved funds, so the platform ledger must say so too
    -- or -sum(user_wallets) would drift from sum(wallets.balance). The other side is a promotional expense.
    perform public.post_ledger('promo_credit_reserve',
      jsonb_build_array(
        jsonb_build_object('account', 'admin_adjustments', 'amount', _promo),
        jsonb_build_object('account', 'user_wallets', 'amount', -(_promo))),
      null, _job_id, _job.driver_id, 'Promotional credit reserved for commission (not cash)');
  end if;

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  update public.jobs set held_commission = _amt, held_commission_promo = _promo where id = _job_id;
  return _amt;
end $function$;

-- Release: the promo part goes back to the promo bucket, never to cash -------------------------------
CREATE OR REPLACE FUNCTION public.release_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
  _amt numeric;
  _promo numeric;
  _bal numeric;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return 0; end if;

  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
     and not (public.has_role(auth.uid(), 'admin'::public.app_role)
              or public.has_role(auth.uid(), 'super_admin'::public.app_role))
  then
    raise exception 'Not authorised to release commission on this job.' using errcode = '42501';
  end if;

  _amt := coalesce(_job.held_commission, 0);
  if _amt = 0 or _job.driver_id is null then
    update public.jobs set held_commission = null where id = _job_id;
    return 0;
  end if;

  update public.wallets
     set held = greatest(coalesce(held, 0) - _amt, 0), updated_at = now()
   where user_id = _job.driver_id;

  _promo := coalesce(_job.held_commission_promo, 0);
  if _promo > 0 then
    update public.wallets
       set balance = greatest(balance - _promo, 0), promo_balance = promo_balance + _promo, updated_at = now()
     where user_id = _job.driver_id returning balance into _bal;
    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note)
    values (_job.driver_id, 'adjustment', -_promo, _bal, _job_id, 'Promotional credit returned to the promo balance (not cash)');
    insert into public.promo_credit_ledger (user_id, amount, kind, job_id, note)
    values (_job.driver_id, _promo, 'release', _job_id, 'Reservation released')
    on conflict do nothing;
    -- (M4) mirror of the reserve: the funds leave the wallet balance again, so the ledger reverses the same entry.
    perform public.post_ledger('promo_credit_release',
      jsonb_build_array(
        jsonb_build_object('account', 'user_wallets', 'amount', _promo),
        jsonb_build_object('account', 'admin_adjustments', 'amount', -(_promo))),
      null, _job_id, _job.driver_id, 'Promotional credit returned to the promo balance (not cash)');
  end if;

  update public.jobs set held_commission = null, held_commission_promo = 0 where id = _job_id;
  return _amt;
end $function$;

-- Availability checks count the promo credit (it can only ever pay commission) ----------------------
CREATE OR REPLACE FUNCTION public.driver_can_accept_for(_job_id uuid, _driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _req numeric;
  _bal numeric; _held numeric; _avail numeric; _promo numeric;
  _free boolean; _has_profile boolean;
  _uid uuid := auth.uid();
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  if not coalesce((
       _uid = _driver_id
    or public.has_role(_uid, 'admin'::public.app_role)
    or public.has_role(_uid, 'super_admin'::public.app_role)
    or (_uid = _job.customer_id
        and exists (select 1 from public.bids b where b.job_id = _job_id and b.driver_id = _driver_id))
    or (_uid is null and auth.role() = 'service_role')
  ), false) then
    raise exception 'Not authorised to check this driver''s balance.' using errcode = '42501';
  end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = _driver_id;
  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'available', 0,
      'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0), coalesce(promo_balance,0)
    into _bal, _held, _promo
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0) + coalesce(_promo,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'promo', coalesce(_promo,0), 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'promo', coalesce(_promo,0), 'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

CREATE OR REPLACE FUNCTION public.driver_can_accept(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _req  numeric;
  _bal  numeric;
  _held numeric;
  _promo numeric;
  _avail numeric;
  _free boolean;
  _has_profile boolean;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = auth.uid();

  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'balance', 0,
      'held', 0, 'available', 0, 'shortfall', 0,
      'free', false, 'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0), coalesce(promo_balance,0)
    into _bal, _held, _promo
    from public.wallets where user_id = auth.uid();
  _bal  := coalesce(_bal, 0);
  _held := coalesce(_held, 0);
  _promo := coalesce(_promo, 0);
  _avail := _bal - _held + _promo;

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0, 'balance', _bal,
      'held', _held, 'available', _avail, 'promo', _promo, 'shortfall', 0, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object(
    'ok', _avail >= _req, 'required', _req, 'balance', _bal,
    'held', _held, 'available', _avail, 'promo', _promo,
    'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

-- The feed's "can you afford this job" also counts promo credit (internal function renamed in 0133).
CREATE OR REPLACE FUNCTION public._driver_available_jobs_exact(_limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, material text, custom_material text, quantity_m3 numeric, budget numeric, delivery_address text, delivery_lat double precision, delivery_lng double precision, preferred_date date, notes text, created_at timestamp with time zone, expires_at timestamp with time zone, bid_count bigint, my_bid_id uuid, my_bid_price numeric, my_offer_id uuid, offer_expires_at timestamp with time zone, commission_due numeric, can_afford boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _rate  numeric;
  _avail numeric;
  _free  boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if not exists (select 1 from public.driver_profiles where user_id = auth.uid()) then
    raise exception 'Driver profile required';
  end if;
  if not public.is_verified_driver(auth.uid()) then
    return;
  end if;

  select (value::text)::numeric into _rate from public.system_settings where key = 'commission_rate';
  _rate := coalesce(_rate, 0);

  select coalesce(balance, 0) - coalesce(held, 0) + coalesce(promo_balance, 0)
    into _avail from public.wallets where user_id = auth.uid();
  _avail := coalesce(_avail, 0);

  select coalesce(first_job_free_used, false) into _free from public.driver_profiles where user_id = auth.uid();

  return query
  select
    j.id, j.material::text, j.custom_material, j.quantity_m3, j.budget, j.delivery_address, j.delivery_lat, j.delivery_lng,
    j.preferred_date, j.notes, j.created_at, j.expires_at,
    (select count(*) from public.bids b where b.job_id = j.id and b.status = 'pending') as bid_count,
    mb.id as my_bid_id, mb.price as my_bid_price, off.id as my_offer_id, off.expires_at as offer_expires_at,
    case when _free then round(coalesce(j.budget, 0) * _rate / 100.0, 2) else 0 end as commission_due,
    case when not _free then true else _avail >= round(coalesce(j.budget, 0) * _rate / 100.0, 2) end as can_afford
  from public.jobs j
  left join lateral (
    select b.id, b.price from public.bids b
     where b.job_id = j.id and b.driver_id = auth.uid() and b.status = 'pending' limit 1
  ) mb on true
  left join lateral (
    select o.id, o.expires_at from public.job_dispatch_offers o
     where o.job_id = j.id and o.driver_id = auth.uid() and o.status = 'pending' and o.expires_at > now() limit 1
  ) off on true
  where j.status = 'open' and j.driver_id is null
    and (j.expires_at is null or j.expires_at > now())
    and j.customer_id <> auth.uid()
  order by (off.id is not null) desc, j.created_at desc
  limit greatest(1, least(_limit, 100))
  offset greatest(0, _offset);
end $function$;

-- Direct-pay settlement: the promo inside the reserve is SPENT (not returned) -------------------------------
-- Requires 0113 (settle_direct_pay_job charges the reserved amount). This is that function plus one line.
create or replace function public.settle_direct_pay_job(_job_id uuid, _actor uuid)
returns public.jobs language plpgsql security definer set search_path to 'public', 'extensions' as $fn$
declare
  _job public.jobs; _rate numeric; _commission numeric;
  _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
  _held numeric; _note text;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.payment_method <> 'direct' then raise exception 'Job % is not a direct-pay job', _job_id; end if;
  if _job.status not in ('accepted', 'in_progress') then raise exception 'Job not in progress'; end if;

  if not public.is_valid_money(coalesce(_job.final_price, _job.budget)) then
    raise exception 'Job % has an invalid price and cannot be completed; contact support', _job_id;
  end if;

  select (value::text)::numeric into _rate from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  select first_job_free_used, true, level into _free_used, _has_profile, _level
    from public.driver_profiles where user_id = _job.driver_id
     for update;
  if not coalesce(_has_profile, false) then
    raise exception 'Driver profile missing for driver %', _job.driver_id;
  end if;

  -- (0113) The amount reserved at acceptance, read from the row locked above; it must be
  -- taken before release_job_commission() clears jobs.held_commission.
  _held := _job.held_commission;

  -- (0134) Direct pay charges the reserve from the driver's wallet, so any promotional credit inside it is
  -- spent here and must not be handed back to the promo bucket by the release below.
  update public.jobs set held_commission_promo = 0 where id = _job_id;

  perform public.release_job_commission(_job_id);

  if _free_used is not true then
    _commission := 0;
    update public.driver_profiles set first_job_free_used = true where user_id = _job.driver_id;
    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', 0,
            coalesce((select balance from public.wallets where user_id = _job.driver_id), 0),
            _job.id, 'First job free — no commission', _actor);
  else
    if _held is not null and _held > 0 then
      -- (0113) Normal case: charge exactly what was reserved when the driver was accepted,
      -- whatever the price or rate are now.
      _commission := _held;
      if not public.is_valid_money(_commission) then
        raise exception 'Reserved commission % is invalid for job %', _commission, _job_id;
      end if;
      _note := 'Commission reserved at acceptance';
    else
      -- No reserve recorded (job accepted before reserves existed), or reserved as free while
      -- the free first job was unused and since used by another completion (the profile row
      -- lock above serialises completions, so only one job ever gets the free benefit):
      -- 7% of the accepted price, as before 0113.
      _commission := public.commission_amount(coalesce(_job.final_price, _job.budget), _rate);
      if not (_commission >= 0 and _commission <= coalesce(_job.final_price, _job.budget)) then
        raise exception 'Computed commission % is invalid for job %', _commission, _job_id;
      end if;
      _note := format('Commission %s%% on job (%s tier)', _rate, _level);
    end if;

    update public.wallets set balance = balance - _commission, updated_at = now()
     where user_id = _job.driver_id returning balance into _new_bal;
    if _new_bal is null then raise exception 'Driver % has no wallet', _job.driver_id; end if;

    update public.wallets set limited = (_new_bal < 0) where user_id = _job.driver_id;

    insert into public.wallet_transactions (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', -_commission, _new_bal, _job.id,
            _note, _actor);
    if _commission > 0 then
      perform public.post_ledger('direct_commission',
        jsonb_build_array(
          jsonb_build_object('account', 'user_wallets', 'amount', _commission),
          jsonb_build_object('account', 'platform_revenue', 'amount', -(_commission))),
        null, _job.id, _job.driver_id, 'Direct-pay commission');
    end if;
  end if;

  update public.driver_profiles set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  update public.jobs
     set status = 'completed', commission = _commission, completed_at = now()
   where id = _job_id
  returning * into _job;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;
  return _job;
end $fn$;

-- Grant: once, on first verification, only while the switch is on ----------------------------------------
create or replace function public.grant_promo_credit(_driver uuid, _by uuid default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare _on boolean; _amt numeric;
begin
  select coalesce((value #>> '{}')::boolean, false) into _on from public.system_settings where key = 'promo_credit_enabled';
  select coalesce((value #>> '{}')::numeric, 0) into _amt from public.system_settings where key = 'promo_credit_amount';
  if not coalesce(_on, false) or coalesce(_amt, 0) <= 0 or _amt > 1000 then return false; end if;
  if exists (select 1 from public.promo_credit_ledger where user_id = _driver and kind = 'grant') then return false; end if;
  insert into public.wallets (user_id, balance) values (_driver, 0) on conflict (user_id) do nothing;
  insert into public.promo_credit_ledger (user_id, amount, kind, note, created_by)
  values (_driver, round(_amt, 2), 'grant', 'One-time promotional commission credit', _by);
  update public.wallets set promo_balance = promo_balance + round(_amt, 2), updated_at = now() where user_id = _driver;
  insert into public.notifications (user_id, type, title, body)
  values (_driver, 'promo_credit', 'Commission credit added',
          format('You received $%s of promotional commission credit. It can only pay ConZ commission and cannot be withdrawn.', round(_amt, 2)));
  return true;
exception when unique_violation then
  return false;
end $$;
revoke all on function public.grant_promo_credit(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_promo_credit(uuid, uuid) to service_role;

create or replace function public.tg_grant_promo_on_verification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.verification_status = 'verified' and old.verification_status is distinct from new.verification_status then
    perform public.grant_promo_credit(new.user_id);
  end if;
  return new;
end $$;
revoke all on function public.tg_grant_promo_on_verification() from public, anon, authenticated;
create or replace trigger trg_grant_promo_on_verification
  after update of verification_status on public.driver_profiles
  for each row execute function public.tg_grant_promo_on_verification();

create or replace function public.admin_set_promo_credit(_enabled boolean, _amount numeric, _reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change the promotional credit.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _enabled is null or _amount is null or _amount <= 0 or _amount > 1000 then
    raise exception 'Enter on/off and an amount between 0.01 and 1,000.' using errcode = '22023';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  insert into public.system_settings (key, value, updated_by, updated_at) values
    ('promo_credit_enabled', to_jsonb(_enabled), auth.uid(), now()),
    ('promo_credit_amount', to_jsonb(round(_amount, 2)), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.log_admin_action(_action => 'promo_credit_settings_changed',
    _meta => jsonb_build_object('enabled', _enabled, 'amount', round(_amount, 2)), _reason => btrim(_reason));
  return jsonb_build_object('enabled', _enabled, 'amount', round(_amount, 2));
end $$;
revoke all on function public.admin_set_promo_credit(boolean, numeric, text) from public, anon;
grant execute on function public.admin_set_promo_credit(boolean, numeric, text) to authenticated;

-- A verified driver who was approved before the credit existed can be granted it once, by a super admin.
create or replace function public.admin_grant_promo_credit(_driver uuid, _reason text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare _ok boolean;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can grant promotional credit.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _driver = auth.uid() then raise exception 'You cannot grant credit to yourself.' using errcode = '42501'; end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  if not public.is_verified_driver(_driver) then raise exception 'Only a verified driver can receive it.' using errcode = '22023'; end if;
  _ok := public.grant_promo_credit(_driver, auth.uid());
  perform public.log_admin_action(_action => 'promo_credit_granted', _meta => jsonb_build_object('granted', _ok),
                                  _reason => btrim(_reason), _target_user => _driver);
  return _ok;
end $$;
revoke all on function public.admin_grant_promo_credit(uuid, text) from public, anon;
grant execute on function public.admin_grant_promo_credit(uuid, text) to authenticated;

-- Reconciliation: promo balance = ledger, reserved promo = open reservations ------------------------------
create or replace function public.promo_credit_reconciliation()
returns table (check_name text, ok boolean, details jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not (public.has_role(auth.uid(), 'super_admin') or public.has_role(auth.uid(), 'admin')) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return query
  select 'promo_balance_matches_ledger',
         not exists (select 1 from public.wallets w
                      where w.promo_balance <> coalesce((select sum(l.amount) from public.promo_credit_ledger l where l.user_id = w.user_id), 0)),
         coalesce((select jsonb_agg(w.user_id) from public.wallets w
                    where w.promo_balance <> coalesce((select sum(l.amount) from public.promo_credit_ledger l where l.user_id = w.user_id), 0)), '[]'::jsonb);
  return query
  select 'reserved_promo_matches_jobs',
         not exists (select 1 from public.jobs j
                      where coalesce(j.held_commission_promo, 0) <> coalesce(
                              (select -sum(l.amount) from public.promo_credit_ledger l where l.job_id = j.id and l.kind = 'reserve'), 0)
                                                                   - coalesce((select sum(l.amount) from public.promo_credit_ledger l where l.job_id = j.id and l.kind = 'release'), 0)
                        and j.held_commission is not null),
         '[]'::jsonb;
end $$;
revoke all on function public.promo_credit_reconciliation() from public, anon;
grant execute on function public.promo_credit_reconciliation() to authenticated;

-- Activation: ONE controlled step (service role only), run when the owner says go ------------------------------
-- Owner decision 09/11/2026: the $20 promotional credit (demo money, never cash) REPLACES first-job-free.
-- Switches the programme on, grants the one-time credit to verified drivers whose free first job was still unused
-- (they lose that job, so they are made whole), and retires the free job for everyone. Idempotent.
create or replace function public.activate_promo_credit_program()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _r record; _granted int := 0; _retired int;
begin
  insert into public.system_settings (key, value) values ('promo_credit_enabled', 'true'::jsonb)
  on conflict (key) do update set value = 'true'::jsonb, updated_at = now();
  -- Only live accounts: not banned or deleted in the app, and with a login that is not locked.
  for _r in select d.user_id from public.driver_profiles d
             where coalesce(d.first_job_free_used, false) = false and d.verification_status = 'verified'
               and not exists (select 1 from public.profiles p
                                where p.id = d.user_id and (p.deleted_at is not null or p.status::text = 'banned'))
               and not exists (select 1 from auth.users a where a.id = d.user_id and a.banned_until is not null) loop
    if public.grant_promo_credit(_r.user_id) then _granted := _granted + 1; end if;
  end loop;
  with u as (update public.driver_profiles set first_job_free_used = true
              where coalesce(first_job_free_used, false) = false returning 1)
  select count(*) into _retired from u;
  return jsonb_build_object('enabled', true, 'granted', _granted, 'free_job_retired_for', _retired);
end $$;
revoke all on function public.activate_promo_credit_program() from public, anon, authenticated;
grant execute on function public.activate_promo_credit_program() to service_role;

-- From activation on, a new driver profile never starts with a free first job.
create or replace function public.tg_retire_free_first_job()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce((select (value #>> '{}')::boolean from public.system_settings where key = 'promo_credit_enabled'), false) then
    new.first_job_free_used := true;
  end if;
  return new;
end $$;
revoke all on function public.tg_retire_free_first_job() from public, anon, authenticated;
create or replace trigger trg_retire_free_first_job
  before insert on public.driver_profiles
  for each row execute function public.tg_retire_free_first_job();

-- The app reads the programme state to show the right wording (flags only).
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
revoke all on function public.launch_switches() from public, anon;
grant execute on function public.launch_switches() to authenticated, service_role;

-- The public pages (home, Terms) must word the commission correctly: one read of on/off + amount, nothing else.
-- Same pattern as transport_pricing_enabled() (0161).
create or replace function public.promo_credit_public()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'enabled', public._launch_setting_bool('promo_credit_enabled', false),
    'amount',  public._launch_setting_num('promo_credit_amount', 20));
$$;
revoke all on function public.promo_credit_public() from public;
grant execute on function public.promo_credit_public() to anon, authenticated, service_role;

commit;
