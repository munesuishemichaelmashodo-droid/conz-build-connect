
CREATE OR REPLACE FUNCTION public.request_topup(_amount numeric, _method text, _reference text)
 RETURNS wallet_topup_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.wallet_topup_requests; _new_bal numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 100000 THEN
    RAISE EXCEPTION 'Amount must be between $1 and $100,000';
  END IF;
  IF _method NOT IN ('ecocash','onemoney','zipit','bank') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  INSERT INTO public.wallet_topup_requests(user_id, amount, method, reference, status, decided_at)
    VALUES (auth.uid(), ROUND(_amount,2), _method, NULLIF(trim(_reference),''), 'approved', now())
    RETURNING * INTO _r;

  INSERT INTO public.wallets(user_id, balance) VALUES (auth.uid(), 0)
    ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.wallets SET balance = balance + _r.amount, updated_at=now(), limited=false
    WHERE user_id=auth.uid() RETURNING balance INTO _new_bal;

  INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    VALUES (auth.uid(),'topup',_r.amount,_new_bal,
            format('Self top-up via %s (ref %s)',_r.method,COALESCE(_r.reference,'—')),
            auth.uid());

  INSERT INTO public.wallet_audit_log(user_id, actor_id, action, meta)
  VALUES (auth.uid(), auth.uid(), 'topup_self_credited',
          jsonb_build_object('id',_r.id,'amount',_r.amount,'method',_r.method,'new_balance',_new_bal));

  INSERT INTO public.notifications(user_id,type,title,body)
    VALUES (auth.uid(),'wallet_topup','Top-up added',
            format('$%s added to your wallet.',_r.amount::text));

  RETURN _r;
END $function$;
