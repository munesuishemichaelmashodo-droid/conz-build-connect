CREATE TABLE IF NOT EXISTS public.first_job_free_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  identity_key text NOT NULL,
  job_id uuid,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_key)
);

GRANT SELECT ON public.first_job_free_claims TO authenticated;
GRANT ALL ON public.first_job_free_claims TO service_role;

ALTER TABLE public.first_job_free_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own free-job claim" ON public.first_job_free_claims;
CREATE POLICY "Users can view own free-job claim"
ON public.first_job_free_claims
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.tg_protect_driver_profile_system_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.first_job_free_used := false;
    NEW.jobs_completed := 0;
    NEW.rating_avg := 0;
    NEW.rating_count := 0;
    NEW.level := 'bronze';
    NEW.verification_status := 'pending';
    NEW.verification_notes := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.first_job_free_used := OLD.first_job_free_used;
    NEW.jobs_completed := OLD.jobs_completed;
    NEW.rating_avg := OLD.rating_avg;
    NEW.rating_count := OLD.rating_count;
    NEW.level := OLD.level;
    NEW.verification_status := OLD.verification_status;
    NEW.verification_notes := OLD.verification_notes;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_driver_profile_system_fields ON public.driver_profiles;
CREATE TRIGGER protect_driver_profile_system_fields
BEFORE INSERT OR UPDATE ON public.driver_profiles
FOR EACH ROW
EXECUTE FUNCTION public.tg_protect_driver_profile_system_fields();

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
  _identity_key TEXT;
  _claim_inserted INTEGER := 0;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id=_job_id FOR UPDATE;
  IF _job IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF _job.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Only the customer can confirm completion'; END IF;
  IF _job.status NOT IN ('accepted','in_progress') THEN RAISE EXCEPTION 'Job not in progress'; END IF;
  IF _job.driver_id IS NULL THEN RAISE EXCEPTION 'No driver assigned'; END IF;

  SELECT COALESCE((value::text)::numeric, 7) INTO _rate FROM public.system_settings WHERE key='commission_rate';
  IF _rate IS NULL THEN _rate := 7; END IF;

  SELECT first_job_free_used INTO _free_used
    FROM public.driver_profiles WHERE user_id = _job.driver_id FOR UPDATE;

  SELECT lower(regexp_replace(COALESCE(NULLIF(p.phone, ''), p.email, _job.driver_id::text), '[^a-zA-Z0-9@+]', '', 'g'))
    INTO _identity_key
    FROM public.profiles p
    WHERE p.id = _job.driver_id;
  IF _identity_key IS NULL OR length(_identity_key) = 0 THEN
    _identity_key := _job.driver_id::text;
  END IF;

  IF _free_used IS NOT TRUE THEN
    INSERT INTO public.first_job_free_claims(user_id, identity_key, job_id)
    VALUES (_job.driver_id, _identity_key, _job.id)
    ON CONFLICT (identity_key) DO NOTHING;

    GET DIAGNOSTICS _claim_inserted = ROW_COUNT;
  END IF;

  IF _free_used IS NOT TRUE AND _claim_inserted = 1 THEN
    _commission := 0;
    UPDATE public.driver_profiles
      SET first_job_free_used = true
      WHERE user_id = _job.driver_id;

    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,job_id,note,created_by)
    SELECT _job.driver_id,'commission',0,COALESCE(balance,0),_job.id,
           'First job free — no commission',auth.uid()
      FROM public.wallets WHERE user_id=_job.driver_id;
  ELSE
    _commission := ROUND(COALESCE(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

    UPDATE public.driver_profiles
      SET first_job_free_used = true
      WHERE user_id = _job.driver_id;

    UPDATE public.wallets SET balance = balance - _commission, updated_at=now()
      WHERE user_id=_job.driver_id RETURNING balance INTO _new_bal;

    IF _new_bal IS NULL THEN
      INSERT INTO public.wallets(user_id, balance, limited)
      VALUES (_job.driver_id, -_commission, true)
      RETURNING balance INTO _new_bal;
    END IF;

    UPDATE public.wallets SET limited = (_new_bal < _commission) WHERE user_id=_job.driver_id;

    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,job_id,note,created_by)
    VALUES (_job.driver_id,'commission',-_commission,_new_bal,_job.id,
            format('Commission %s%% on job', _rate), auth.uid());
  END IF;

  UPDATE public.driver_profiles SET jobs_completed = jobs_completed + 1 WHERE user_id=_job.driver_id;

  UPDATE public.jobs SET status='completed', commission=_commission WHERE id=_job_id RETURNING * INTO _job;
  RETURN _job;
END;
$function$;