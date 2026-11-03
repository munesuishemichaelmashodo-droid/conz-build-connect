-- Undo 0134 (promotional commission credit). Restores the 03/11/2026 function bodies. Needs the SQL editor (drops objects).
-- FIRST resolve any outstanding promo credit: reserved promo sits in wallets.balance until released or settled.
begin;
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

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;

  update public.jobs set held_commission = _amt where id = _job_id;
  return _amt;
end $function$;

CREATE OR REPLACE FUNCTION public.release_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
  _amt numeric;
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

  update public.jobs set held_commission = null where id = _job_id;
  return _amt;
end $function$;

CREATE OR REPLACE FUNCTION public.driver_can_accept_for(_job_id uuid, _driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _req numeric;
  _bal numeric; _held numeric; _avail numeric;
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

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0) into _bal, _held
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'shortfall', greatest(0, _req - _avail), 'free', false);
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

  select coalesce(balance,0), coalesce(held,0) + coalesce(withdrawal_reserved,0) into _bal, _held
    from public.wallets where user_id = auth.uid();
  _bal  := coalesce(_bal, 0);
  _held := coalesce(_held, 0);
  _avail := _bal - _held;

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0, 'balance', _bal,
      'held', _held, 'available', _avail, 'shortfall', 0, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  return jsonb_build_object(
    'ok', _avail >= _req, 'required', _req, 'balance', _bal,
    'held', _held, 'available', _avail,
    'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

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

  select coalesce(balance, 0) - coalesce(held, 0)
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
-- settle_direct_pay_job back to the 0113 body
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

drop trigger if exists trg_grant_promo_on_verification on public.driver_profiles;
drop function if exists public.tg_grant_promo_on_verification();
drop function if exists public.promo_credit_reconciliation();
drop function if exists public.admin_grant_promo_credit(uuid, text);
drop function if exists public.admin_set_promo_credit(boolean, numeric, text);
drop function if exists public.grant_promo_credit(uuid, uuid);
alter table public.jobs drop column if exists held_commission_promo;
alter table public.wallets drop column if exists promo_balance;
drop table if exists public.promo_credit_ledger;
delete from public.system_settings where key in ('promo_credit_enabled', 'promo_credit_amount');
commit;
