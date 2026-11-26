-- Undo 0185 (run in the Supabase SQL editor: it contains DROP).
-- Restores record_referral to the 0181 body, removes the progress, share and metrics functions and the
-- milestone trigger. Keeps referral_share_events and the milestone revoked_at/revoked_reason columns, so no
-- history is lost; drop them by hand only if the owner asks.
drop trigger if exists trg_referral_status_sync_milestones on public.referrals;
drop function if exists public.tg_referral_status_sync_milestones();
drop function if exists public.sync_referral_milestones(uuid);
drop function if exists public.my_referral_progress();
drop function if exists public.record_referral_share(text);
drop function if exists public.admin_referral_metrics(int);

-- 4. Claiming a code: same rules; the notice no longer promises a reward -----------------------------------
CREATE OR REPLACE FUNCTION public.record_referral(_code text, _referred_role text DEFAULT 'customer'::text, _device_fingerprint text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _referrer_id uuid;
  _referred_id uuid := auth.uid();
  _hold_days int;
  _fraud boolean := false;
  _fraud_reasons text[] := '{}';
  _referred_phone text;
  _dupe_phone_count int;
  _dupe_device_count int;
  _row public.referrals;
BEGIN
  IF _referred_id IS NULL THEN RAISE EXCEPTION 'Must be authenticated'; END IF;
  IF _referred_role NOT IN ('customer','driver') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = _referred_id) THEN
    RAISE EXCEPTION 'This account has already redeemed a referral code';
  END IF;

  SELECT id INTO _referrer_id FROM public.profiles WHERE referral_code = upper(trim(_code));
  IF _referrer_id IS NULL THEN RAISE EXCEPTION 'Referral code not found'; END IF;
  IF _referrer_id = _referred_id THEN RAISE EXCEPTION 'You cannot refer yourself'; END IF;

  SELECT COALESCE((value->>'hold_days')::int, 7) INTO _hold_days
    FROM public.system_settings WHERE key = 'referral_rewards';
  IF _hold_days IS NULL THEN _hold_days := 7; END IF;

  -- Signals for human review only (never an automatic block).
  SELECT phone INTO _referred_phone FROM public.profiles WHERE id = _referred_id;
  IF _referred_phone IS NOT NULL THEN
    SELECT count(*) INTO _dupe_phone_count
      FROM public.referrals rf JOIN public.profiles p ON p.id = rf.referred_id
      WHERE p.phone = _referred_phone AND rf.referred_id <> _referred_id;
    IF _dupe_phone_count > 0 THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'phone number reused across referred accounts');
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _referrer_id AND p.phone = _referred_phone) THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'same phone number as the referrer');
    END IF;
  END IF;

  IF _device_fingerprint IS NOT NULL THEN
    SELECT count(*) INTO _dupe_device_count
      FROM public.referrals WHERE device_fingerprint = _device_fingerprint AND referred_id <> _referred_id;
    IF _dupe_device_count > 0 THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'device fingerprint reused across referred accounts');
    END IF;
  END IF;

  INSERT INTO public.referrals
    (referrer_id, referred_id, referral_code, referred_role, hold_period_days, fraud_flag, fraud_reason, device_fingerprint)
  VALUES
    (_referrer_id, _referred_id, upper(trim(_code)), _referred_role, _hold_days, _fraud,
     NULLIF(array_to_string(_fraud_reasons, '; '), ''), _device_fingerprint)
  RETURNING * INTO _row;

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_referrer_id, 'referral_joined', 'Someone joined with your referral code',
    format('A new %s signed up with your code. Your referral is recognised once they meet the requirements.', _referred_role));

  RETURN _row;
END $function$;
revoke all on function public.record_referral(text, text, text) from public, anon;
grant execute on function public.record_referral(text, text, text) to authenticated, service_role;

