-- =============================================================================
-- 0072 — Financial numeric integrity (security audit F1, CRITICAL)
-- =============================================================================
--
-- Problem (verified against live definitions on 07/10/2026):
--   * bids.price, bids.customer_counter_price, jobs.budget/final_price have no
--     range CHECK. A verified driver could bid a negative price; accept_bid
--     copied it into jobs.final_price; complete_job then computed a NEGATIVE
--     commission and did `balance - commission`, i.e. CREDITED the driver.
--   * Postgres numeric accepts 'NaN' (and 'Infinity' in unconstrained
--     columns). NaN sorts above every number, so `x <= 0` is false for NaN and
--     every "is it too small?" guard passed. A NaN wallet balance would then
--     pass every `balance - held < amount` check in the withdrawal path.
--   * counter_bid / raise_job_budget only rejected `<= 0`, so NaN passed.
--   * admin_credit_wallet / admin_wallet_adjust accepted NaN / ±Infinity.
--
-- Fix:
--   1. public.is_valid_money(): one definition of "a valid positive amount":
--      0 < v <= limit. Because NaN compares greater than any number and
--      ±Infinity fall outside the range, this single range test rejects
--      negative, zero, NaN and ±Infinity.
--   2. Range CHECK constraints on every money / quantity column. Added
--      NOT VALID so existing rows are never rewritten or rejected (one
--      cancelled 21/07 job has budget 0.00); they apply to every new INSERT
--      and to every UPDATE of a row. wallets is validated outright (all rows
--      verified clean on 07/10/2026).
--   3. Every RPC that turns a price into a balance movement re-validates the
--      value it is about to use (defence in depth against legacy rows), and
--      commission can never be negative.
--
-- Limits: $100,000 per job / bid / payment matches the existing top-up and
-- withdrawal caps (wallet_topup_requests / wallet_withdrawal_requests CHECKs).
-- Driver wallets may still go negative through the existing direct-pay
-- commission debit (which sets `limited`), so balance has a finite floor
-- rather than >= 0. `held` must be >= 0.
--
-- Function bodies below are the LIVE definitions (pg_get_functiondef,
-- 07/10/2026) with only the marked F1 additions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Validation helper
-- -----------------------------------------------------------------------------
create or replace function public.is_valid_money(_v numeric, _max numeric default 100000)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  -- NaN > 0 is TRUE in Postgres but NaN <= _max is FALSE, and ±Infinity fail
  -- one side or the other, so this range test also rejects non-finite input.
  select _v is not null and _v > 0 and _v <= _max
$$;

comment on function public.is_valid_money(numeric, numeric) is
  'F1: true only for a finite amount with 0 < v <= _max (rejects negative, zero, NaN, ±Infinity).';

grant execute on function public.is_valid_money(numeric, numeric) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Constraints
-- -----------------------------------------------------------------------------
alter table public.bids
  add constraint bids_price_valid
    check (price > 0 and price <= 100000) not valid,
  add constraint bids_counter_price_valid
    check (customer_counter_price is null or (customer_counter_price > 0 and customer_counter_price <= 100000)) not valid;

alter table public.jobs
  add constraint jobs_budget_valid
    check (budget > 0 and budget <= 100000) not valid,
  add constraint jobs_final_price_valid
    check (final_price is null or (final_price > 0 and final_price <= 100000)) not valid,
  add constraint jobs_quantity_valid
    check (quantity_m3 > 0 and quantity_m3 <= 1000) not valid,
  add constraint jobs_delivered_quantity_valid
    check (delivered_quantity_m3 is null or (delivered_quantity_m3 >= 0 and delivered_quantity_m3 <= 1000)) not valid,
  add constraint jobs_commission_valid
    check (commission is null or (commission >= 0 and commission <= 100000)) not valid,
  add constraint jobs_held_commission_valid
    check (held_commission is null or (held_commission >= 0 and held_commission <= 100000)) not valid;

alter table public.payments
  add constraint payments_amount_valid
    check (amount > 0 and amount <= 100000) not valid;

alter table public.trucks
  add constraint trucks_capacity_valid
    check (capacity_m3 > 0 and capacity_m3 <= 100) not valid;

alter table public.price_quotes
  add constraint price_quotes_distance_valid
    check (distance_km >= 0 and distance_km <= 5000) not valid,
  add constraint price_quotes_quantity_valid
    check (quantity_m3 > 0 and quantity_m3 <= 1000) not valid;

-- Wallets: finite balance with a floor (controlled negative balances exist by
-- design, see header), held never negative. Validated: live rows are clean.
alter table public.wallets
  add constraint wallets_balance_finite
    check (balance >= -100000 and balance <= 10000000) not valid,
  add constraint wallets_held_valid
    check (held >= 0 and held <= 10000000) not valid;
alter table public.wallets validate constraint wallets_balance_finite;
alter table public.wallets validate constraint wallets_held_valid;

-- Ledger rows are immutable, so NOT VALID never matters for old rows; new
-- rows must be finite.
alter table public.wallet_transactions
  add constraint wallet_transactions_amount_finite
    check (amount >= -10000000 and amount <= 10000000) not valid,
  add constraint wallet_transactions_balance_after_finite
    check (balance_after >= -100000 and balance_after <= 10000000) not valid;

-- -----------------------------------------------------------------------------
-- 3. Customer-side price RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.counter_bid(_bid_id uuid, _price numeric)
 RETURNS bids
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _bid public.bids; _job public.jobs;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  -- F1: was `_price <= 0`, which let NaN through.
  IF NOT public.is_valid_money(_price) THEN RAISE EXCEPTION 'Enter a valid price'; END IF;

  SELECT * INTO _bid FROM public.bids WHERE id = _bid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'; END IF;
  IF _bid.status <> 'pending' THEN RAISE EXCEPTION 'This bid is no longer open'; END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _bid.job_id;
  IF _job.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Not your job'; END IF;
  IF _job.status <> 'open' THEN RAISE EXCEPTION 'Job is no longer open'; END IF;

  UPDATE public.bids
     SET customer_counter_price = _price, counter_status = 'countered'
   WHERE id = _bid_id
  RETURNING * INTO _bid;

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_bid.driver_id, 'bid_countered', 'Customer proposed a new price',
          format('They offered $%s on your bid of $%s for %s.', _price::text, _bid.price::text, _job.material),
          _job.id);

  RETURN _bid;
END $function$;

CREATE OR REPLACE FUNCTION public.raise_job_budget(_job_id uuid, _new_budget numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
  _cap numeric;
begin
  if auth.uid() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  -- F1: NaN passed the old `<= budget` comparison (NaN sorts highest).
  if not public.is_valid_money(_new_budget) then
    raise exception 'Enter a valid amount.';
  end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can change this offer.' using errcode = '42501';
  end if;
  if _job.status <> 'open' then
    raise exception 'Drivers can only see price changes while the job is open.';
  end if;
  if _new_budget is null or _new_budget <= _job.budget then
    raise exception 'You can only raise your offer.';
  end if;

  _cap := nullif(_job.pricing_breakdown->>'high', '')::numeric;
  if _cap is not null and _new_budget > _cap then
    raise exception 'The most you can offer for this trip is $%.', _cap;
  end if;

  -- tg_validate_job_budget re-checks the new budget against the pricing
  -- engine (and raises if it's out of range).
  update public.jobs set budget = round(_new_budget, 2) where id = _job_id;

  -- Undo that trigger's UPDATE-time side effects so the job keeps the
  -- supply source and price range from its original quote. (This UPDATE
  -- doesn't touch budget/material, so the trigger doesn't fire again.)
  update public.jobs
     set supply_location_id = _job.supply_location_id,
         pricing_breakdown  = _job.pricing_breakdown,
         pricing_version    = _job.pricing_version
   where id = _job_id;

  return round(_new_budget, 2);
end $function$;

-- -----------------------------------------------------------------------------
-- 4. Acceptance paths (price -> jobs.final_price)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_bid(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _bid   public.bids;
  _job   public.jobs;
  _guard jsonb;
  _loc   public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Bid not found'; end if;

  select * into _job from public.jobs where id = _bid.job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.status <> 'open' then raise exception 'Job not open'; end if;
  if _bid.status <> 'pending' then raise exception 'Bid no longer available'; end if;

  -- F1: never let an invalid price become the job's final price.
  if not public.is_valid_money(_bid.price) then
    raise exception 'This offer has an invalid price and cannot be accepted.';
  end if;

  -- Inventory reservation: only for jobs with a resolved supply location.
  if _job.supply_location_id is not null then
    select * into _loc from public.material_supply_locations
      where id = _job.supply_location_id for update;
    if found and _loc.available_quantity_m3 is not null then
      if _loc.available_quantity_m3 < _job.quantity_m3 then
        raise exception 'This supply location no longer has enough available quantity (needs % m³, has % m³)',
          _job.quantity_m3, _loc.available_quantity_m3;
      end if;
      update public.material_supply_locations
         set available_quantity_m3 = available_quantity_m3 - _job.quantity_m3,
             updated_at = now()
       where id = _loc.id;
    end if;
  end if;

  update public.bids set status = 'accepted' where id = _bid_id;
  update public.bids set status = 'rejected'
   where job_id = _job.id and id <> _bid_id and status = 'pending';

  update public.jobs
     set status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.price
   where id = _job.id
  returning * into _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  if (_guard->>'ok')::boolean is not true then
    raise exception 'Driver has insufficient wallet balance: needs $%, has $% available',
      _guard->>'required', _guard->>'available';
  end if;

  perform public.hold_job_commission(_job.id);

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job.id and status = 'pending';

  return _job;
end $function$;

CREATE OR REPLACE FUNCTION public.accept_counter(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE _bid public.bids; _job public.jobs; _guard jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;

  SELECT * INTO _bid FROM public.bids WHERE id = _bid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found'; END IF;
  IF _bid.driver_id <> auth.uid() THEN RAISE EXCEPTION 'Not your bid'; END IF;
  IF _bid.status <> 'pending' THEN RAISE EXCEPTION 'Bid no longer available'; END IF;
  IF _bid.counter_status <> 'countered' THEN RAISE EXCEPTION 'No pending counter-offer on this bid'; END IF;

  -- F1: the counter price becomes final_price below.
  IF NOT public.is_valid_money(_bid.customer_counter_price) THEN
    RAISE EXCEPTION 'This counter-offer has an invalid price and cannot be accepted.';
  END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _bid.job_id FOR UPDATE;
  IF _job.status <> 'open' THEN RAISE EXCEPTION 'Job not open'; END IF;

  UPDATE public.bids SET price = _bid.customer_counter_price, status = 'accepted', counter_status = 'driver_accepted'
   WHERE id = _bid_id;
  UPDATE public.bids SET status = 'rejected'
   WHERE job_id = _job.id AND id <> _bid_id AND status = 'pending';

  UPDATE public.jobs
     SET status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.customer_counter_price
   WHERE id = _job.id
  RETURNING * INTO _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  IF (_guard->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Insufficient wallet balance: need $%, have $% available',
      _guard->>'required', _guard->>'available';
  END IF;

  PERFORM public.hold_job_commission(_job.id);

  UPDATE public.job_dispatch_offers
     SET status = 'superseded', responded_at = now()
   WHERE job_id = _job.id AND status = 'pending';

  INSERT INTO public.notifications(user_id, type, title, body, job_id)
  VALUES (_job.customer_id, 'bid_accepted', 'Driver accepted your price!',
          format('They agreed to $%s for your %s delivery.', _bid.customer_counter_price::text, _job.material), _job.id);

  RETURN _job;
END $function$;

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  offer_row public.job_dispatch_offers%rowtype;
  job_row   public.jobs%rowtype;
  guard     jsonb;
begin
  select * into offer_row from public.job_dispatch_offers
    where id = _offer_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if offer_row.driver_id <> auth.uid() then raise exception 'Not your offer'; end if;
  if offer_row.status <> 'pending' then raise exception 'Offer no longer available'; end if;

  if offer_row.expires_at < now() then
    update public.job_dispatch_offers
       set status = 'expired', responded_at = now() where id = _offer_id;
    raise exception 'Offer expired';
  end if;

  select * into job_row from public.jobs where id = offer_row.job_id for update;
  if job_row.status <> 'open' then raise exception 'Job no longer available'; end if;

  -- F1: coalesce(final_price, budget) becomes the job's final price below.
  if not public.is_valid_money(coalesce(job_row.final_price, job_row.budget)) then
    raise exception 'This job has an invalid price and cannot be accepted.';
  end if;

  guard := public.driver_can_accept(job_row.id);
  if (guard->>'ok')::boolean is not true then
    raise exception 'Insufficient wallet balance: need $% commission, have $% available',
      guard->>'required', guard->>'available';
  end if;

  update public.jobs
     set driver_id = auth.uid(), status = 'accepted',
         final_price = coalesce(final_price, budget)
   where id = job_row.id;

  perform public.hold_job_commission(job_row.id);

  -- Reject every competing pending bid on this job, same as accept_bid()/
  -- accept_counter(), so bid-status queries can't show a rejected
  -- driver as still active. Their trg_notify_bid_status trigger fires
  -- the "job went to another driver" notification for us.
  update public.bids
     set status = 'rejected'
   where job_id = job_row.id and status = 'pending';

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;
  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = job_row.id and id <> _offer_id and status = 'pending';

  return job_row.id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 5. Commission reservation and completion
-- -----------------------------------------------------------------------------
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

  _amt := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;

  update public.jobs set held_commission = _amt where id = _job_id;
  return _amt;
end $function$;

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

    _commission := round(coalesce(_job.final_price, _job.budget) * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);

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
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;

  -- Security fix (audit finding C-2). Legitimate callers, in order of
  -- likelihood: the customer (via complete_job), the driver (via
  -- driver_confirm_delivery_pin), or nobody (auth.uid() IS NULL, via the
  -- auto_release_escrow_payments sweep -- safe ONLY because EXECUTE is
  -- revoked from anon/authenticated above, so a direct anonymous RPC call
  -- can no longer reach this line at all). Anyone else is rejected.
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> _job.customer_id
     AND auth.uid() <> _job.driver_id
  THEN
    RAISE EXCEPTION 'Not authorised to release this job''s escrow.' USING ERRCODE = '42501';
  END IF;

  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'Job % is not an escrow job', _job_id; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  SELECT * INTO _payment FROM public.payments
    WHERE job_id = _job_id AND type = 'escrow' AND status = 'paid'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed escrow payment for this job yet'; END IF;

  -- F1: the payout is computed from the held amount.
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
    _commission := round(_payment.amount * _rate / 100.0
                          * public.driver_level_commission_multiplier(_level), 2);
  END IF;
  _payout := _payment.amount - _commission;

  -- F1: commission within [0, amount]; payout within [0, amount].
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

-- -----------------------------------------------------------------------------
-- 6. Admin money RPCs: amount must be finite, non-zero and within limits.
--    (Role, MFA, self-target and cap rules are hardened in Phase 6.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _prev numeric; _new numeric; _w public.wallets;
begin
  if not public.has_role(auth.uid(),'super_admin') then raise exception 'Only super admins can credit wallets directly'; end if;
  if _user_id = auth.uid() then raise exception 'Admins cannot adjust their own wallet.'; end if;
  -- F1: was only `_amount = 0`; NaN / ±Infinity passed.
  if _amount is null or _amount = 0 or not public.is_valid_money(abs(_amount)) then
    raise exception 'Amount must be a non-zero value up to $100,000';
  end if;
  if _note is null or btrim(_note) = '' then raise exception 'A written reason is required'; end if;
  insert into public.wallets(user_id, balance) values (_user_id, 0) on conflict (user_id) do nothing;
  select balance into _prev from public.wallets where user_id = _user_id for update;
  _new := _prev + _amount;
  if _new < 0 then raise exception 'This would take the wallet negative (balance %, change %)', _prev, _amount; end if;
  update public.wallets set balance = _new, updated_at = now(), limited = (_new < 0) where user_id = _user_id;
  insert into public.wallet_transactions(user_id, type, amount, balance_after, previous_balance, note, created_by)
  values (_user_id, case when _amount > 0 then 'topup'::public.tx_type else 'adjustment'::public.tx_type end, _amount, _new, _prev, _note, auth.uid());
  perform public.log_admin_action(case when _amount > 0 then 'wallet_credited_by_admin' else 'wallet_debited_by_admin' end,
    jsonb_build_object('amount', _amount, 'previous_balance', _prev, 'new_balance', _new), _note, null, _user_id);
  select * into _w from public.wallets where user_id = _user_id; return _w;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(_user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text, _ip text DEFAULT NULL::text, _device jsonb DEFAULT '{}'::jsonb)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _is_super boolean; _threshold numeric; _prev_bal numeric; _new_bal numeric; _tx public.wallet_transactions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  PERFORM public.require_admin_mfa();
  -- F1: was only `_amount = 0`; NaN / ±Infinity passed.
  IF _amount IS NULL OR _amount = 0 OR NOT public.is_valid_money(abs(_amount)) THEN
    RAISE EXCEPTION 'Amount must be a non-zero value up to $100,000';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'A written reason is required'; END IF;

  _is_super := public.has_role(auth.uid(),'super_admin');
  SELECT COALESCE((value->>'threshold')::numeric, 500) INTO _threshold FROM public.system_settings WHERE key = 'admin_wallet_threshold';
  IF _threshold IS NULL THEN _threshold := 500; END IF;
  IF abs(_amount) > _threshold AND NOT _is_super THEN
    RAISE EXCEPTION 'Amounts over % require super admin approval', _threshold;
  END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO _prev_bal FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  _new_bal := _prev_bal + _amount;
  IF _new_bal < 0 THEN RAISE EXCEPTION 'This deduction would take the wallet negative (balance %, deduct %)', _prev_bal, abs(_amount); END IF;

  UPDATE public.wallets SET balance = _new_bal, updated_at = now(), limited = false WHERE user_id = _user_id;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount, balance_after, previous_balance, category, note, created_by, ip_address, device_info)
  VALUES (_user_id, 'adjustment', _amount, _new_bal, _prev_bal, _category, _reason, auth.uid(), _ip, _device)
  RETURNING * INTO _tx;

  PERFORM public.log_admin_action(
    CASE WHEN _amount > 0 THEN 'wallet_credited_by_admin' ELSE 'wallet_debited_by_admin' END,
    jsonb_build_object('amount', _amount, 'category', _category, 'previous_balance', _prev_bal, 'new_balance', _new_bal, 'ip', _ip, 'device', _device),
    _reason, _tx.id, _user_id
  );

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'wallet_adjustment',
    CASE WHEN _amount > 0 THEN 'Wallet credited' ELSE 'Wallet debited' END,
    format('Your wallet was %s $%s. Reason: %s', CASE WHEN _amount > 0 THEN 'credited with' ELSE 'debited by' END, to_char(abs(_amount), 'FM999999990.00'), _reason));

  RETURN _tx;
END $function$;
