-- 0091_flat_commission  (PREPARED, NOT APPLIED)
--
-- OWNER DECISION (11/10/2026): ConZ commission is a FLAT rate (system_settings.
-- commission_rate, currently 7%) for every driver level. Levels carry
-- non-financial benefits only. No level-based discounts or multipliers.
--
-- PROBLEM: the amount HELD at acceptance and checked by the affordability gate
-- was rate-only, while the amount CHARGED at completion (complete_job,
-- release_escrow_and_complete) was rate x driver_level_commission_multiplier.
-- Each path hand-rolled its own expression.
--
-- FIX: one authoritative function, commission_amount(basis, rate), used by every
-- path. Basis = the accepted job price (material + transport):
--   * hold / gate / list / direct completion: coalesce(jobs.final_price, jobs.budget)
--   * escrow release: payments.amount (paynow.functions.ts sets it from the same
--     coalesce(final_price, budget), so the bases agree)
-- Rounding: numeric round(basis * rate / 100, 2) (half away from zero), applied
-- once. The first-job-free rule (a separate, existing rule) is unchanged.
--
-- Bodies below are the CURRENT definitions of each function (latest file in git)
-- with exactly one expression replaced. driver_level_commission_multiplier() is
-- left in place, unused (types.ts references it); it can be dropped later.
--
-- Production data: read-only check 11/10/2026 found 7 drivers, all bronze; all 6
-- completed charges equal the flat rate; 6 active jobs, holds equal the flat rate
-- (3 are 0.00 = first-job-free). No reconciliation of existing records is needed.
--
-- Depends on: 0072 (hold/complete bodies), 0074 (escrow body), 0082 (complete_job
-- body with ledger posting), 0065. Apply after those. Idempotent.

create or replace function public.commission_amount(_basis numeric, _rate numeric default null)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare r numeric := _rate;
begin
  if _basis is not null and not (_basis >= 0) then
    raise exception 'invalid_commission_basis';
  end if;
  if r is null then
    select (value::text)::numeric into r from public.system_settings where key = 'commission_rate';
  end if;
  if r is null then raise exception 'commission_rate not configured'; end if;
  if not (r >= 0 and r <= 100) then raise exception 'commission_rate is invalid'; end if;
  return round(coalesce(_basis, 0) * r / 100.0, 2);
end $$;
revoke all on function public.commission_amount(numeric, numeric) from public, anon, authenticated;
grant execute on function public.commission_amount(numeric, numeric) to service_role;

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

  -- Defense-in-depth (see migration header): legitimate callers are
  -- accept_bid/accept_counter/accept_dispatch_offer, which by this point
  -- have already set _job.driver_id to the accepting driver and already
  -- verified the caller is that driver or the job's customer.
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
  -- F1: a corrupted rate must never produce a negative / non-finite hold.
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  -- F1: the hold is a percentage of a validated, positive price.
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

  select coalesce(balance,0), coalesce(held,0) into _bal, _held
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
end $function$
;

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

  -- The driver checking themself, an admin, or the job's customer accepting
  -- a bid from this driver (accept_bid / accept_counter). A NULL uid is
  -- only allowed for the server's own service_role key.
  -- coalesce: with a NULL uid every comparison is NULL, and IF NOT NULL
  -- does not raise — the check must treat "unknown" as "not allowed".
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

  select coalesce(balance,0), coalesce(held,0) into _bal, _held
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

CREATE OR REPLACE FUNCTION public.count_available_verified_drivers(_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _req  numeric;
  _n    integer;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return 0; end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  _rate := coalesce(_rate, 7);

  _req := public.commission_amount(coalesce(_job.final_price, _job.budget, 0), _rate);

  select count(*)::int into _n
  from public.driver_profiles dp
  join public.profiles p on p.id = dp.user_id
  left join public.wallets w on w.user_id = dp.user_id
  where dp.verification_status = 'verified'
    and p.status = 'active'
    and coalesce(w.limited, false) = false
    and (
      -- first job is free, so no balance needed
      coalesce(dp.first_job_free_used, false) = false
      or (coalesce(w.balance, 0) - coalesce(w.held, 0)) >= _req
    )
    and dp.user_id <> _job.customer_id;

  return coalesce(_n, 0);
end $function$
;

CREATE OR REPLACE FUNCTION public.complete_job(_job_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _commission numeric;
  _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can confirm completion';
  end if;
  if _job.status not in ('accepted','in_progress') then
    raise exception 'Job not in progress';
  end if;

  if _job.payment_method = 'escrow' then
    return public.release_escrow_and_complete(_job_id, auth.uid());
  end if;

  -- F1: commission is computed from this price; it must be a valid positive amount.
  if not public.is_valid_money(coalesce(_job.final_price, _job.budget)) then
    raise exception 'Job % has an invalid price and cannot be completed; contact support', _job_id;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;
  if not (_rate >= 0 and _rate <= 100) then raise exception 'commission_rate is invalid'; end if;

  select first_job_free_used, true, level into _free_used, _has_profile, _level
    from public.driver_profiles where user_id = _job.driver_id;

  if not coalesce(_has_profile, false) then
    raise exception 'Driver profile missing for driver %', _job.driver_id;
  end if;

  perform public.release_job_commission(_job_id);

  if _free_used is not true then
    _commission := 0;
    update public.driver_profiles
       set first_job_free_used = true where user_id = _job.driver_id;

    insert into public.wallet_transactions
      (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', 0,
      coalesce((select balance from public.wallets
                 where user_id = _job.driver_id), 0),
      _job.id, 'First job free — no commission', auth.uid());
  else
    if _job.final_price is null and _job.budget is null then
      raise exception 'Cannot compute commission: job % has no final_price or budget', _job_id;
    end if;

    _commission := public.commission_amount(coalesce(_job.final_price, _job.budget), _rate);

    -- F1: a commission is a debit. It can never be negative (which would
    -- credit the driver) or exceed the job price.
    if not (_commission >= 0 and _commission <= coalesce(_job.final_price, _job.budget)) then
      raise exception 'Computed commission % is invalid for job %', _commission, _job_id;
    end if;

    update public.wallets
       set balance = balance - _commission, updated_at = now()
     where user_id = _job.driver_id
    returning balance into _new_bal;

    if _new_bal is null then
      raise exception 'Driver % has no wallet', _job.driver_id;
    end if;

    update public.wallets
       set limited = (_new_bal < 0) where user_id = _job.driver_id;

    insert into public.wallet_transactions
      (user_id, type, amount, balance_after, job_id, note, created_by)
    values (_job.driver_id, 'commission', -_commission, _new_bal, _job.id,
            format('Commission %s%% on job (%s tier)', _rate, _level), auth.uid());
    if _commission > 0 then
      -- Ledger (0082)
      perform public.post_ledger('direct_commission',
        jsonb_build_array(
          jsonb_build_object('account', 'user_wallets', 'amount',  _commission),
          jsonb_build_object('account', 'platform_revenue', 'amount', -(_commission))),
        null, _job.id, _job.driver_id, 'Direct-pay commission');
    end if;
  end if;

  update public.driver_profiles
     set jobs_completed = jobs_completed + 1 where user_id = _job.driver_id;

  update public.jobs
     set status = 'completed', commission = _commission
   where id = _job_id
  returning * into _job;

  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='jobs'
                and column_name='completed_at') then
    execute 'update public.jobs set completed_at = now() where id = $1' using _job_id;
  end if;

  if to_regprocedure('public.issue_pod(uuid)') is not null then
    perform public.issue_pod(_job_id);
  end if;

  return _job;
end $function$;

CREATE OR REPLACE FUNCTION public.release_escrow_and_complete(_job_id uuid, _actor uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _job public.jobs; _payment public.payments; _rate numeric; _commission numeric;
  _payout numeric; _new_bal numeric; _free_used boolean; _has_profile boolean; _level driver_level;
  _lines jsonb;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _job.customer_id
     AND auth.uid() <> _job.driver_id
  THEN
    RAISE EXCEPTION 'Not authorised to release this job''s escrow.' USING ERRCODE = '42501';
  END IF;

  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'Job % is not an escrow job', _job_id; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  -- Only a 'paid' payment can be released (refund_due / refunded cannot).
  SELECT * INTO _payment FROM public.payments
    WHERE job_id = _job_id AND type = 'escrow' AND status = 'paid'
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed escrow payment for this job yet'; END IF;

  IF NOT public.is_valid_money(_payment.amount) THEN
    RAISE EXCEPTION 'Escrow payment % has an invalid amount; contact support', _payment.id;
  END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key = 'commission_rate';
  IF _rate IS NULL THEN RAISE EXCEPTION 'commission_rate not configured'; END IF;
  IF NOT (_rate >= 0 AND _rate <= 100) THEN RAISE EXCEPTION 'commission_rate is invalid'; END IF;

  SELECT first_job_free_used, true, level INTO _free_used, _has_profile, _level
    FROM public.driver_profiles WHERE user_id = _job.driver_id;
  IF NOT COALESCE(_has_profile, false) THEN
    RAISE EXCEPTION 'Driver profile missing for driver %', _job.driver_id;
  END IF;

  IF _free_used IS NOT TRUE THEN
    _commission := 0;
    UPDATE public.driver_profiles SET first_job_free_used = true WHERE user_id = _job.driver_id;
  ELSE
    _commission := public.commission_amount(_payment.amount, _rate);
  END IF;
  _payout := _payment.amount - _commission;

  IF NOT (_commission >= 0 AND _commission <= _payment.amount AND _payout >= 0 AND _payout <= _payment.amount) THEN
    RAISE EXCEPTION 'Computed escrow split is invalid for job %', _job_id;
  END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_job.driver_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _payout, updated_at = now(), limited = false
   WHERE user_id = _job.driver_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by)
  VALUES (_job.driver_id, 'topup', _payout, _new_bal, _job.id,
          format('Con Z Pay escrow release — %s%% commission already deducted (%s tier)', _rate, _level), _actor);

  UPDATE public.payments SET status = 'released', updated_at = now() WHERE id = _payment.id;

  -- F2/F9: escrow leaves the held account; driver payout + platform commission.
  _lines := jsonb_build_array(jsonb_build_object('account', 'escrow_held', 'amount', _payment.amount));
  IF _payout > 0 THEN
    _lines := _lines || jsonb_build_object('account', 'user_wallets', 'amount', -_payout);
  END IF;
  IF _commission > 0 THEN
    _lines := _lines || jsonb_build_object('account', 'platform_revenue', 'amount', -_commission);
  END IF;
  PERFORM public.post_ledger('escrow_released', _lines, _payment.id, _job.id, _job.driver_id, 'Escrow released to driver');

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = _job.driver_id;

  PERFORM public.release_job_commission(_job_id);

  UPDATE public.jobs
     SET status = 'completed', commission = _commission, completed_at = now()
   WHERE id = _job_id
  RETURNING * INTO _job;

  IF to_regprocedure('public.issue_pod(uuid)') IS NOT NULL THEN
    PERFORM public.issue_pod(_job_id);
  END IF;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.driver_id, 'escrow_released', 'Payment released to you!',
          format('$%s has been added to your wallet for this delivery.', _payout::text), _job.id);

  RETURN _job;
END $function$;
