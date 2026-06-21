
ALTER TABLE public.driver_profiles
  ADD COLUMN IF NOT EXISTS first_job_free_used boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.complete_job(_job_id uuid)
RETURNS jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job public.jobs;
  _rate NUMERIC;
  _commission NUMERIC;
  _new_bal NUMERIC;
  _free_used BOOLEAN;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id=_job_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF _job.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Only the customer can confirm completion'; END IF;
  IF _job.status NOT IN ('accepted','in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;

  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key='commission_rate';

  SELECT first_job_free_used INTO _free_used
    FROM public.driver_profiles WHERE user_id = _job.driver_id;

  IF _free_used IS NOT TRUE THEN
    -- First job free: no commission deducted, mark benefit used
    _commission := 0;
    UPDATE public.driver_profiles
      SET first_job_free_used = true
      WHERE user_id = _job.driver_id;

    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,job_id,note,created_by)
    SELECT _job.driver_id,'commission',0,COALESCE(balance,0),_job.id,
           'First job free — no commission',auth.uid()
      FROM public.wallets WHERE user_id=_job.driver_id;
  ELSE
    _commission := ROUND(_job.final_price * _rate / 100.0, 2);

    UPDATE public.wallets SET balance = balance - _commission, updated_at=now()
      WHERE user_id=_job.driver_id RETURNING balance INTO _new_bal;
    UPDATE public.wallets SET limited = (_new_bal < _commission) WHERE user_id=_job.driver_id;

    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,job_id,note,created_by)
    VALUES (_job.driver_id,'commission',-_commission,_new_bal,_job.id,
            format('Commission %s%% on job', _rate), auth.uid());
  END IF;

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id=_job.driver_id;

  UPDATE public.jobs SET status='completed', commission=_commission WHERE id=_job_id RETURNING * INTO _job;
  RETURN _job;
END $function$;
