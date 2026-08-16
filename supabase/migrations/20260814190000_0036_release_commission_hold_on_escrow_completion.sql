-- 0036: release_escrow_and_complete correctly deducts commission from the
-- driver's escrow payout, but never releases the matching hold that
-- accept_bid() placed via hold_job_commission() (wallets.held +=,
-- jobs.held_commission). Found in a separate session investigating a
-- driver wallet-balance report -- that specific report turned out to be
-- correct behavior (funds legitimately held against other active jobs),
-- but surfaced this dormant issue: since no escrow job had completed yet,
-- the stuck-hold bug hadn't fired. It would have permanently inflated
-- wallets.held (and so permanently reduced the driver's computed
-- available balance for accepting future jobs) on every escrow job
-- completion from here on.
--
-- release_job_commission() already exists and is exactly the right call
-- -- idempotent, safe against a double-release pushing held negative --
-- it was just never wired into the escrow completion path.

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
  IF _job.payment_method <> 'escrow' THEN RAISE EXCEPTION 'Job % is not an escrow job', _job_id; END IF;
  IF _job.status NOT IN ('accepted', 'in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  SELECT * INTO _payment FROM public.payments
    WHERE job_id = _job_id AND type = 'escrow' AND status = 'paid'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No confirmed escrow payment for this job yet'; END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key = 'commission_rate';
  IF _rate IS NULL THEN RAISE EXCEPTION 'commission_rate not configured'; END IF;

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

  INSERT INTO public.wallets(user_id, balance) VALUES (_job.driver_id, 0) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _payout, updated_at = now(), limited = false
   WHERE user_id = _job.driver_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by)
  VALUES (_job.driver_id, 'topup', _payout, _new_bal, _job.id,
          format('Con Z Pay escrow release — %s%% commission already deducted (%s tier)', _rate, _level), _actor);

  UPDATE public.payments SET status = 'released', updated_at = now() WHERE id = _payment.id;

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id = _job.driver_id;

  -- Release the commission hold placed at acceptance -- this is the fix.
  -- Commission was already correctly deducted above via the payout math;
  -- without this call the held amount from hold_job_commission() at
  -- accept_bid() would never come back down.
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
