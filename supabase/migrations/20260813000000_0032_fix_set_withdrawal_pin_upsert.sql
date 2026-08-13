-- 0032: Fix set_withdrawal_pin silently doing nothing when the caller has
-- no driver_profiles row yet. Previously this ran a plain UPDATE, which
-- affects 0 rows (no error) if the row doesn't exist -- the RPC returned
-- success and the frontend showed "PIN saved" even though nothing was
-- written. Switch to an upsert.

CREATE OR REPLACE FUNCTION public.set_withdrawal_pin(_pin text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF _pin IS NULL OR length(_pin) < 4 OR length(_pin) > 8 OR _pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;
  INSERT INTO public.driver_profiles (user_id, withdrawal_pin_hash)
    VALUES (auth.uid(), crypt(_pin, gen_salt('bf')))
    ON CONFLICT (user_id) DO UPDATE SET withdrawal_pin_hash = EXCLUDED.withdrawal_pin_hash;
  INSERT INTO public.pin_attempts(user_id, fail_count) VALUES (auth.uid(),0)
    ON CONFLICT (user_id) DO UPDATE SET fail_count=0, locked_until=NULL, updated_at=now();
  INSERT INTO public.wallet_audit_log(user_id,actor_id,action,meta)
    VALUES (auth.uid(),auth.uid(),'pin_set','{}'::jsonb);
END $$;
