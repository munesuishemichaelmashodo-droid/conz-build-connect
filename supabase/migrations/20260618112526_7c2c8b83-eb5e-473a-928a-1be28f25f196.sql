
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text)
RETURNS public.wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.wallets SET balance = balance + _amount, updated_at = now()
  WHERE user_id = _user_id RETURNING balance INTO _new_bal;

  UPDATE public.wallets SET limited = (_new_bal < 0) WHERE user_id = _user_id
  RETURNING * INTO _w;

  INSERT INTO public.wallet_transactions(user_id, type, amount, balance_after, note, created_by)
  VALUES (_user_id,
          CASE WHEN _amount > 0 THEN 'topup'::public.tx_type ELSE 'adjustment'::public.tx_type END,
          _amount, _new_bal, COALESCE(_note,'Admin adjustment'), auth.uid());

  RETURN _w;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(_user_id uuid, _status public.account_status)
RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.profiles;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.profiles SET status = _status, updated_at = now()
  WHERE id = _user_id RETURNING * INTO _p;
  RETURN _p;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_commission(_rate numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change commission';
  END IF;
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Rate must be 0-100'; END IF;
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('commission_rate', to_jsonb(_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  RETURN to_jsonb(_rate);
END $$;

CREATE OR REPLACE FUNCTION public.admin_grant_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can grant roles';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can revoke roles';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END $$;

CREATE OR REPLACE FUNCTION public.claim_super_admin()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    RAISE EXCEPTION 'Super admin already exists';
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (auth.uid(), 'super_admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles(user_id, role) VALUES (auth.uid(), 'admin') ON CONFLICT DO NOTHING;
END $$;
