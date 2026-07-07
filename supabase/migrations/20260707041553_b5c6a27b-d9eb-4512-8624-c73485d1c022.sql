
-- 1. Extend tx_type enum
ALTER TYPE public.tx_type ADD VALUE IF NOT EXISTS 'withdrawal';

-- 2. Enable pgcrypto for PIN hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3. Top-up request table
CREATE TABLE public.wallet_topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  method text NOT NULL CHECK (method IN ('ecocash','onemoney','zipit','bank')),
  reference text,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reject_reason text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_topup_user ON public.wallet_topup_requests(user_id, created_at DESC);
CREATE INDEX idx_topup_status ON public.wallet_topup_requests(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.wallet_topup_requests TO authenticated;
GRANT ALL ON public.wallet_topup_requests TO service_role;
ALTER TABLE public.wallet_topup_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topup_owner_select" ON public.wallet_topup_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "topup_owner_insert" ON public.wallet_topup_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');
CREATE POLICY "topup_owner_cancel" ON public.wallet_topup_requests FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending','cancelled'));
CREATE POLICY "topup_admin_update" ON public.wallet_topup_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 4. Withdrawal request table
CREATE TABLE public.wallet_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  method text NOT NULL CHECK (method IN ('ecocash','onemoney','zipit','bank')),
  destination text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reject_reason text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wd_user ON public.wallet_withdrawal_requests(user_id, created_at DESC);
CREATE INDEX idx_wd_status ON public.wallet_withdrawal_requests(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.wallet_withdrawal_requests TO authenticated;
GRANT ALL ON public.wallet_withdrawal_requests TO service_role;
ALTER TABLE public.wallet_withdrawal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wd_owner_select" ON public.wallet_withdrawal_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "wd_owner_insert" ON public.wallet_withdrawal_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');
CREATE POLICY "wd_owner_cancel" ON public.wallet_withdrawal_requests FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending','cancelled'));
CREATE POLICY "wd_admin_update" ON public.wallet_withdrawal_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 5. Wallet audit log
CREATE TABLE public.wallet_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_user ON public.wallet_audit_log(user_id, created_at DESC);
GRANT SELECT ON public.wallet_audit_log TO authenticated;
GRANT ALL ON public.wallet_audit_log TO service_role;
ALTER TABLE public.wallet_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_read_own_or_admin" ON public.wallet_audit_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 6. Withdrawal PIN + attempts
ALTER TABLE public.driver_profiles ADD COLUMN IF NOT EXISTS withdrawal_pin_hash text;

CREATE TABLE public.pin_attempts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fail_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pin_attempts TO authenticated;
GRANT ALL ON public.pin_attempts TO service_role;
ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pin_read_own" ON public.pin_attempts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 7. Lock down direct writes on wallets and wallet_transactions
REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.wallet_transactions FROM authenticated;

-- 8. RPCs

-- request_topup
CREATE OR REPLACE FUNCTION public.request_topup(_amount numeric, _method text, _reference text)
RETURNS wallet_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_topup_requests; _pending int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000 THEN
    RAISE EXCEPTION 'Amount must be between $1 and $100,000';
  END IF;
  IF _method NOT IN ('ecocash','onemoney','zipit','bank') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;
  SELECT COUNT(*) INTO _pending FROM public.wallet_topup_requests
    WHERE user_id = auth.uid() AND status = 'pending';
  IF _pending >= 5 THEN RAISE EXCEPTION 'Too many pending top-ups. Cancel one first.'; END IF;

  INSERT INTO public.wallet_topup_requests(user_id, amount, method, reference)
    VALUES (auth.uid(), ROUND(_amount,2), _method, NULLIF(trim(_reference),''))
    RETURNING * INTO _r;

  INSERT INTO public.wallet_audit_log(user_id, actor_id, action, meta)
  VALUES (auth.uid(), auth.uid(), 'topup_requested',
          jsonb_build_object('id',_r.id,'amount',_r.amount,'method',_r.method));
  RETURN _r;
END $$;

-- cancel_topup
CREATE OR REPLACE FUNCTION public.cancel_topup(_id uuid)
RETURNS wallet_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_topup_requests;
BEGIN
  UPDATE public.wallet_topup_requests
    SET status='cancelled', decided_at=now()
    WHERE id=_id AND user_id=auth.uid() AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot cancel'; END IF;
  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (auth.uid(),auth.uid(),'topup_cancelled',jsonb_build_object('id',_id));
  RETURN _r;
END $$;

-- admin_approve_topup
CREATE OR REPLACE FUNCTION public.admin_approve_topup(_id uuid)
RETURNS wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_topup_requests; _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO _r FROM public.wallet_topup_requests WHERE id=_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _r.status = 'approved' THEN
    SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id; RETURN _w;
  END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Request not pending'; END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_r.user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets SET balance = balance + _r.amount, updated_at=now(), limited=false
    WHERE user_id=_r.user_id RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    VALUES (_r.user_id,'topup',_r.amount,_new_bal,
            format('Top-up via %s (ref %s)',_r.method,COALESCE(_r.reference,'—')),
            auth.uid());

  UPDATE public.wallet_topup_requests
    SET status='approved', decided_by=auth.uid(), decided_at=now()
    WHERE id=_id;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (_r.user_id,auth.uid(),'topup_approved',
            jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_topup','Top-up approved',
            format('$%s added to your wallet.',_r.amount::text));

  SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id;
  RETURN _w;
END $$;

-- admin_reject_topup
CREATE OR REPLACE FUNCTION public.admin_reject_topup(_id uuid, _reason text)
RETURNS wallet_topup_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_topup_requests;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.wallet_topup_requests
    SET status='rejected', reject_reason=_reason, decided_by=auth.uid(), decided_at=now()
    WHERE id=_id AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot reject'; END IF;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (_r.user_id,auth.uid(),'topup_rejected',jsonb_build_object('id',_id,'reason',_reason));

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_topup','Top-up rejected',
            COALESCE(_reason,'Your top-up request was rejected.'));
  RETURN _r;
END $$;

-- set_withdrawal_pin
CREATE OR REPLACE FUNCTION public.set_withdrawal_pin(_pin text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;
  UPDATE public.driver_profiles
    SET withdrawal_pin_hash = crypt(_pin, gen_salt('bf'))
    WHERE user_id = auth.uid();
  INSERT INTO public.pin_attempts(user_id, fail_count) VALUES (auth.uid(),0)
    ON CONFLICT (user_id) DO UPDATE SET fail_count=0, locked_until=NULL, updated_at=now();
  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (auth.uid(),auth.uid(),'pin_set','{}'::jsonb);
END $$;

-- request_withdrawal (verifies PIN)
CREATE OR REPLACE FUNCTION public.request_withdrawal(_amount numeric, _method text, _destination text, _pin text)
RETURNS wallet_withdrawal_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_withdrawal_requests; _bal numeric; _hash text; _att public.pin_attempts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF _method NOT IN ('ecocash','onemoney','zipit','bank') THEN RAISE EXCEPTION 'Invalid method'; END IF;
  IF _destination IS NULL OR length(trim(_destination)) < 4 THEN RAISE EXCEPTION 'Destination required'; END IF;

  SELECT * INTO _att FROM public.pin_attempts WHERE user_id=auth.uid();
  IF _att.locked_until IS NOT NULL AND _att.locked_until > now() THEN
    RAISE EXCEPTION 'Too many wrong PINs. Try again later.';
  END IF;

  SELECT withdrawal_pin_hash INTO _hash FROM public.driver_profiles WHERE user_id=auth.uid();
  IF _hash IS NULL THEN RAISE EXCEPTION 'Set a withdrawal PIN in Profile first'; END IF;
  IF crypt(COALESCE(_pin,''), _hash) <> _hash THEN
    INSERT INTO public.pin_attempts(user_id,fail_count) VALUES (auth.uid(),1)
    ON CONFLICT (user_id) DO UPDATE
      SET fail_count = public.pin_attempts.fail_count + 1,
          locked_until = CASE WHEN public.pin_attempts.fail_count + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
          updated_at = now();
    INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
      VALUES (auth.uid(),auth.uid(),'pin_failed','{}'::jsonb);
    RAISE EXCEPTION 'Wrong PIN';
  END IF;
  UPDATE public.pin_attempts SET fail_count=0, locked_until=NULL, updated_at=now() WHERE user_id=auth.uid();

  SELECT balance INTO _bal FROM public.wallets WHERE user_id=auth.uid();
  IF COALESCE(_bal,0) < _amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  INSERT INTO public.wallet_withdrawal_requests(user_id,amount,method,destination)
    VALUES (auth.uid(), ROUND(_amount,2), _method, trim(_destination))
    RETURNING * INTO _r;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (auth.uid(),auth.uid(),'withdrawal_requested',
            jsonb_build_object('id',_r.id,'amount',_r.amount,'method',_r.method));
  RETURN _r;
END $$;

-- cancel_withdrawal
CREATE OR REPLACE FUNCTION public.cancel_withdrawal(_id uuid)
RETURNS wallet_withdrawal_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_withdrawal_requests;
BEGIN
  UPDATE public.wallet_withdrawal_requests
    SET status='cancelled', decided_at=now()
    WHERE id=_id AND user_id=auth.uid() AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot cancel'; END IF;
  RETURN _r;
END $$;

-- admin_approve_withdrawal
CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(_id uuid)
RETURNS wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT * INTO _r FROM public.wallet_withdrawal_requests WHERE id=_id FOR UPDATE;
  IF _r IS NULL OR _r.status <> 'pending' THEN RAISE EXCEPTION 'Not pending'; END IF;

  UPDATE public.wallets SET balance = balance - _r.amount, updated_at=now()
    WHERE user_id=_r.user_id RETURNING balance INTO _new_bal;
  IF _new_bal < 0 THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    VALUES (_r.user_id,'withdrawal',-_r.amount,_new_bal,
            format('Withdrawal via %s',_r.method), auth.uid());

  UPDATE public.wallet_withdrawal_requests SET status='approved', decided_by=auth.uid(), decided_at=now() WHERE id=_id;

  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (_r.user_id,auth.uid(),'withdrawal_approved',
            jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal approved',
            format('$%s withdrawn from your wallet.',_r.amount::text));

  SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id;
  RETURN _w;
END $$;

-- admin_reject_withdrawal
CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(_id uuid, _reason text)
RETURNS wallet_withdrawal_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.wallet_withdrawal_requests;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.wallet_withdrawal_requests
    SET status='rejected', reject_reason=_reason, decided_by=auth.uid(), decided_at=now()
    WHERE id=_id AND status='pending'
    RETURNING * INTO _r;
  IF _r IS NULL THEN RAISE EXCEPTION 'Cannot reject'; END IF;
  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal rejected',COALESCE(_reason,'Your withdrawal was rejected.'));
  RETURN _r;
END $$;

-- driver_can_accept: returns balance vs required commission
CREATE OR REPLACE FUNCTION public.driver_can_accept(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _job public.jobs; _rate numeric; _req numeric; _bal numeric; _free boolean;
BEGIN
  SELECT * INTO _job FROM public.jobs WHERE id=_job_id;
  IF _job IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  SELECT first_job_free_used INTO _free FROM public.driver_profiles WHERE user_id=auth.uid();
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
END $$;

-- Update accept_dispatch_offer to check balance
CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  offer_row public.job_dispatch_offers%ROWTYPE;
  job_row public.jobs%ROWTYPE;
  guard jsonb;
BEGIN
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
END $$;

-- 9. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_topup_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_withdrawal_requests;
