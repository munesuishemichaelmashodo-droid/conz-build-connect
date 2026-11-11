-- 0113: direct-pay settlement charges exactly the commission reserved at acceptance.
--
-- PREPARED, NOT APPLIED. Founders approved the design on 25/10/2026; apply only with their
-- explicit go-ahead. No DROP statements. App deploy order: none (database only, same
-- signature, same grants, same return type).
--
-- Defect (live body = migration 0096, hash c9f46993...): settle_direct_pay_job() recomputes
-- 7% from the job's price and the commission_rate at completion instead of charging
-- jobs.held_commission, the amount reserved by hold_job_commission() at acceptance. If a super
-- admin changes the rate, or an admin edits the price, while a job is active, the driver is
-- charged a different amount from what was reserved, and the balance can go below zero.
-- Reproduced locally: rate 7% -> 10% after acceptance charged $40 instead of the reserved $28;
-- price $400 -> $600 charged $42 instead of $28 (pgTAP 440, 6 of 24 checks failed before).
--
-- Fix (only the commission amount changes; release, wallet, ledger, completion unchanged):
--   * free first job still unused            -> 0, mark used (unchanged)
--   * reserve recorded and > 0               -> charge exactly held_commission
--   * no reserve recorded (null)             -> 7% of the accepted price (legacy, unchanged)
--   * reserved as free (0) but the free job was used by another completion in the meantime
--                                            -> 7% of the accepted price (unchanged; founders'
--                                               decision: one free job per driver)
-- The driver_profiles row lock already serialises a driver's completions, so two parallel
-- completions cannot both receive the free benefit (concurrency check S8), and the jobs row
-- lock + status check stop a job being charged twice (S7, pgTAP 240/440).
-- Escrow settlement (release_escrow_and_complete) is out of scope: escrow is switched off.
--
-- Rollback: supabase/rollbacks/20261025100000_0113_rollback.sql (exact production definition).

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
revoke all on function public.settle_direct_pay_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.settle_direct_pay_job(uuid, uuid) to service_role;
