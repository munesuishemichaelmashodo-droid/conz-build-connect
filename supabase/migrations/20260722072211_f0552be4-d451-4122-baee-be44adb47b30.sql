
DROP POLICY IF EXISTS "Drivers create bids" ON public.bids;
CREATE POLICY "Drivers create bids" ON public.bids
FOR INSERT
WITH CHECK (
  driver_id = auth.uid()
  AND public.has_role(auth.uid(), 'driver'::public.app_role)
  AND EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id = auth.uid() AND w.limited = false)
  AND EXISTS (SELECT 1 FROM public.driver_profiles dp WHERE dp.user_id = auth.uid() AND dp.verification_status = 'verified')
);

CREATE OR REPLACE FUNCTION public.driver_can_accept(_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _job public.jobs; _rate numeric; _req numeric; _bal numeric; _free boolean; _vs public.verification_status;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id=_job_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  SELECT verification_status, first_job_free_used INTO _vs, _free
    FROM public.driver_profiles WHERE user_id=auth.uid();
  IF _vs IS DISTINCT FROM 'verified'::public.verification_status THEN
    RAISE EXCEPTION 'Your driver account is still pending verification';
  END IF;

  IF _free IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',true,'required',0,'balance',
      COALESCE((SELECT balance FROM public.wallets WHERE user_id=auth.uid()),0),
      'shortfall',0,'free',true);
  END IF;
  SELECT (value::text)::numeric INTO _rate FROM public.system_settings WHERE key='commission_rate';
  _req := ROUND(COALESCE(_job.final_price,_job.budget,0) * COALESCE(_rate,7) / 100.0, 2);
  SELECT COALESCE(balance,0) INTO _bal FROM public.wallets WHERE user_id=auth.uid();
  RETURN jsonb_build_object('ok', _bal >= _req, 'required', _req, 'balance', _bal,
    'shortfall', GREATEST(0, _req - _bal), 'free', false);
END $function$;

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(_offer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  offer_row public.job_dispatch_offers%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  guard jsonb;
  _vs public.verification_status;
BEGIN
  SELECT verification_status INTO _vs FROM public.driver_profiles WHERE user_id = auth.uid();
  IF _vs IS DISTINCT FROM 'verified'::public.verification_status THEN
    RAISE EXCEPTION 'Your driver account is still pending verification';
  END IF;

  SELECT * INTO offer_row FROM public.job_dispatch_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found'; END IF;
  IF offer_row.driver_id <> auth.uid() THEN RAISE EXCEPTION 'Not your offer'; END IF;
  IF offer_row.status <> 'pending' THEN RAISE EXCEPTION 'Offer no longer available'; END IF;
  IF offer_row.expires_at < now() THEN
    UPDATE public.job_dispatch_offers SET status='expired', responded_at=now() WHERE id=_offer_id;
    RAISE EXCEPTION 'Offer expired';
  END IF;
  SELECT * INTO job_row FROM public.jobs WHERE id = offer_row.job_id FOR UPDATE;
  IF job_row.status <> 'open' THEN RAISE EXCEPTION 'Job no longer available'; END IF;

  guard := public.driver_can_accept(job_row.id);
  IF (guard->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Insufficient wallet balance: need $% commission, have $%',
      guard->>'required', guard->>'balance';
  END IF;

  UPDATE public.jobs SET driver_id=auth.uid(), status='accepted',
    final_price = COALESCE(final_price, budget) WHERE id = job_row.id;
  UPDATE public.job_dispatch_offers SET status='accepted', responded_at=now() WHERE id=_offer_id;
  UPDATE public.job_dispatch_offers SET status='superseded', responded_at=now()
    WHERE job_id=job_row.id AND id<>_offer_id AND status='pending';
  RETURN job_row.id;
END $function$;
