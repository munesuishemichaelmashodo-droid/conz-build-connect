-- 0037: MFA step-up (require_admin_mfa(), checking session_aal() = 'aal2')
-- was added to the two brand-new hardened wallet functions
-- (admin_wallet_adjust, admin_wallet_reverse) but not to the older
-- functions doing equally or more sensitive things -- found during a
-- security review of the new MFA/referral/wallet-hardening work.
--
-- Confirmed all five below are still the live code path the frontend
-- actually calls (not dead/superseded code):
--   admin_grant_role / admin_revoke_role -- can grant/revoke super_admin;
--     this is the most serious gap, a straight path to full privilege
--     escalation with no second factor if a session is compromised.
--   admin_approve_withdrawal / admin_approve_topup -- move real money,
--     same category of action admin_wallet_adjust already requires MFA for.
--   admin_set_user_status -- suspend/ban; lower financial stakes but still
--     a meaningful admin action, included for consistency.
--
-- Each gets exactly one added line -- PERFORM public.require_admin_mfa();
-- right after the existing role check -- mirroring the exact pattern
-- already used by admin_wallet_adjust/admin_wallet_reverse. No other
-- logic changed.

CREATE OR REPLACE FUNCTION public.admin_grant_role(_user_id uuid, _role app_role, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can grant roles';
  END IF;
  PERFORM public.require_admin_mfa();
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role) ON CONFLICT DO NOTHING;
  PERFORM public.log_admin_action('role_granted', jsonb_build_object('role', _role), _reason, NULL, _user_id);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_user_id uuid, _role app_role, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can revoke roles';
  END IF;
  PERFORM public.require_admin_mfa();
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
  PERFORM public.log_admin_action('role_revoked', jsonb_build_object('role', _role), _reason, NULL, _user_id);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_approve_topup(_id uuid)
RETURNS wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r public.wallet_topup_requests; _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  PERFORM public.require_admin_mfa();
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

  PERFORM public.log_admin_action('topup_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), NULL, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_topup','Top-up approved',
            format('$%s added to your wallet.',_r.amount::text));

  SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id;
  RETURN _w;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(_id uuid)
RETURNS wallets LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  PERFORM public.require_admin_mfa();
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

  PERFORM public.log_admin_action('withdrawal_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), NULL, _id, _r.user_id);

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (_r.user_id,'wallet_withdrawal','Withdrawal approved',
            format('$%s withdrawn from your wallet.',_r.amount::text));

  SELECT * INTO _w FROM public.wallets WHERE user_id=_r.user_id;
  RETURN _w;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(_user_id uuid, _status account_status, _reason text DEFAULT NULL::text)
RETURNS profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _p public.profiles; _old account_status;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  PERFORM public.require_admin_mfa();
  IF _status <> 'active' AND (_reason IS NULL OR length(trim(_reason)) < 5) THEN
    RAISE EXCEPTION 'Give a reason for suspending/banning this account (at least 5 characters) — it is recorded in the audit log.';
  END IF;
  SELECT status INTO _old FROM public.profiles WHERE id = _user_id;
  UPDATE public.profiles SET status = _status, updated_at = now()
  WHERE id = _user_id RETURNING * INTO _p;
  PERFORM public.log_admin_action('user_status_changed', jsonb_build_object('old_status', _old, 'new_status', _status), _reason, NULL, _user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'user_status_changed',
          CASE WHEN _status = 'active' THEN 'Your account is active again' ELSE 'Your account status changed' END,
          CASE WHEN _status = 'suspended' THEN COALESCE('Your account has been suspended. Reason: ' || _reason, 'Your account has been suspended. Contact support for details.')
               WHEN _status = 'banned' THEN COALESCE('Your account has been banned. Reason: ' || _reason, 'Your account has been banned.')
               ELSE 'Your account is now active.' END);

  RETURN _p;
END $function$;

-- Also drop the legacy 2-arg admin_set_user_status(uuid, account_status)
-- overload -- superseded by the 3-arg version above (which the frontend
-- already exclusively calls), but a raw RPC call using exactly 2 args
-- would have routed to the old unprotected overload via Postgres
-- function overload resolution, bypassing both the MFA check and the
-- mandatory-reason requirement.
DROP FUNCTION IF EXISTS public.admin_set_user_status(uuid, account_status);
