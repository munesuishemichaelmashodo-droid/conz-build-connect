-- Undo 0181: restores the three referral functions exactly as they were live on 26/11/2026 (read with
-- pg_get_functiondef from production; line endings normalised), turns the referral-money guard into a
-- pass-through (removing the trigger would need DROP), and gives back the table grants that 0181 revoked.
-- WARNING: this brings back the cash-like referral rewards (wallet credits). Owner approval required.

create or replace function public.tg_wallet_tx_no_referral_money()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.admin_referral_action(_referral_id uuid, _action text, _notes text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.referrals; _new_bal numeric; _tx public.wallet_transactions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_admin_mfa();
  IF _action NOT IN ('approve','reject','freeze','release','unfreeze') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO _r FROM public.referrals WHERE id = _referral_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Referral not found'; END IF;
  -- Second audit (0085): no self-dealing on referrals.
  IF auth.uid() IN (_r.referrer_id, _r.referred_id) THEN
    RAISE EXCEPTION 'You cannot act on a referral you are part of.' USING ERRCODE = '42501';
  END IF;

  IF _action = 'approve' THEN
    UPDATE public.referrals SET reward_status = 'approved', fraud_flag = false, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'reject' THEN
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Cannot reject an already-released reward — use a wallet reversal instead'; END IF;
    UPDATE public.referrals SET reward_status = 'rejected', admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body) VALUES (_r.referrer_id, 'referral_reward_rejected', 'Referral reward rejected', COALESCE('Reason: ' || _notes, 'Your referral reward was rejected after review.'));
  ELSIF _action = 'freeze' THEN
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Cannot freeze an already-released reward'; END IF;
    UPDATE public.referrals SET reward_status = 'frozen', fraud_flag = true, fraud_reason = COALESCE(_notes, fraud_reason, 'Frozen by admin for review'), admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'unfreeze' THEN
    UPDATE public.referrals SET reward_status = 'hold', fraud_flag = false, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'release' THEN
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Already released'; END IF;
    IF _r.reward_amount IS NULL THEN RAISE EXCEPTION 'No reward amount set on this referral yet'; END IF;
    -- Second audit (0085): only an approved / held, un-flagged reward can be
    -- released, and releasing credits a wallet -> super_admin + MFA + cap.
    IF _r.reward_status NOT IN ('approved', 'hold') OR coalesce(_r.fraud_flag, false) THEN
      RAISE EXCEPTION 'Only an approved, unflagged reward can be released (status %).', _r.reward_status;
    END IF;
    PERFORM public.admin_money_guard(_r.referrer_id, _r.reward_amount, 'credit', 'referral_release', _r.id);
    INSERT INTO public.wallets(user_id, balance) VALUES (_r.referrer_id, 0) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET balance = balance + _r.reward_amount, updated_at = now() WHERE user_id = _r.referrer_id RETURNING balance INTO _new_bal;
    INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, note) VALUES (_r.referrer_id, 'referral_bonus', _r.reward_amount, _new_bal, 'Referral reward — released by admin') RETURNING * INTO _tx;
    UPDATE public.referrals SET reward_status = 'released', reward_transaction_id = _tx.id, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body) VALUES (_r.referrer_id, 'referral_reward_released', 'Referral reward released', format('Your referral reward of $%s has been added to your wallet.', _r.reward_amount));
  END IF;

  PERFORM public.log_admin_action('referral_' || _action, jsonb_build_object('referral_id', _referral_id, 'notes', _notes), _notes, _referral_id, _r.referrer_id);
  RETURN _r;
END $function$;

CREATE OR REPLACE FUNCTION public.process_referral_lifecycle()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _settings jsonb;
  _customer_amt numeric;
  _customer_credit numeric;
  _driver_amt numeric;
  _driver_min_deliveries int;
  r record;
  _new_bal numeric;
  _tx public.wallet_transactions;
  _milestone int;
  _count int;
BEGIN
  SELECT value INTO _settings FROM public.system_settings WHERE key = 'referral_rewards';
  _customer_amt := COALESCE((_settings->>'customer_referrer_amount')::numeric, 10);
  _customer_credit := COALESCE((_settings->>'customer_referred_credit')::numeric, 5);
  _driver_amt := COALESCE((_settings->>'driver_referrer_amount')::numeric, 15);
  _driver_min_deliveries := COALESCE((_settings->>'driver_min_deliveries')::int, 5);

  -- ---- Customer track: first paid, completed delivery ----
  FOR r IN
    SELECT rf.* FROM public.referrals rf
    WHERE rf.referred_role = 'customer' AND rf.verification_status = 'pending'
      AND rf.reward_status = 'pending' AND NOT rf.fraud_flag
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.payments p ON p.job_id = j.id AND p.status = 'paid'
      WHERE j.customer_id = r.referred_id AND j.status = 'completed'
    ) THEN
      UPDATE public.referrals
        SET verification_status = 'verified',
            reward_status = 'hold',
            reward_amount = _customer_amt,
            reward_release_at = now() + (r.hold_period_days || ' days')::interval
        WHERE id = r.id;

      -- Referred customer gets their first-order credit immediately (not fraud-sensitive the same way)
      INSERT INTO public.wallets(user_id, balance) VALUES (r.referred_id, 0) ON CONFLICT (user_id) DO NOTHING;
      UPDATE public.wallets SET balance = balance + _customer_credit, updated_at = now()
        WHERE user_id = r.referred_id RETURNING balance INTO _new_bal;
      INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, note)
        VALUES (r.referred_id, 'referral_bonus', _customer_credit, _new_bal, 'First-order referral credit')
        RETURNING id INTO _tx;
      UPDATE public.referrals SET referred_credit_transaction_id = _tx.id WHERE id = r.id;

      INSERT INTO public.notifications(user_id, type, title, body)
      VALUES (r.referred_id, 'referral_first_order_credit', 'Referral credit added',
              format('You received a $%s credit for completing your first delivery.', _customer_credit));
      INSERT INTO public.notifications(user_id, type, title, body)
      VALUES (r.referrer_id, 'referral_verified', 'Referral verified',
              'Your referral completed their first delivery. Your reward is now in a 7-day hold period before release.');
    END IF;
  END LOOP;

  -- ---- Driver track: KYC verified + approved + >= N deliveries + no active disputes ----
  FOR r IN
    SELECT rf.* FROM public.referrals rf
    WHERE rf.referred_role = 'driver' AND rf.verification_status = 'pending'
      AND rf.reward_status = 'pending' AND NOT rf.fraud_flag
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.driver_profiles dp
      WHERE dp.user_id = r.referred_id
        AND dp.verification_status = 'verified'
        AND dp.jobs_completed >= _driver_min_deliveries
        AND NOT EXISTS (
          SELECT 1 FROM public.disputes d
          WHERE d.against = r.referred_id AND d.status IN ('open','investigating')
        )
    ) THEN
      UPDATE public.referrals
        SET verification_status = 'verified',
            reward_status = 'hold',
            reward_amount = _driver_amt,
            reward_release_at = now() + (r.hold_period_days || ' days')::interval
        WHERE id = r.id;

      INSERT INTO public.notifications(user_id, type, title, body)
      VALUES (r.referrer_id, 'referral_verified', 'Referral verified',
              'Your referred driver completed the requirements. Your reward is now in a 7-day hold period before release.');
    END IF;
  END LOOP;

  -- ---- Release rewards whose hold period has passed ----
  FOR r IN
    SELECT * FROM public.referrals
    WHERE reward_status = 'hold' AND reward_release_at IS NOT NULL AND reward_release_at <= now()
  LOOP
    INSERT INTO public.wallets(user_id, balance) VALUES (r.referrer_id, 0) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET balance = balance + r.reward_amount, updated_at = now()
      WHERE user_id = r.referrer_id RETURNING balance INTO _new_bal;
    INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, note)
      VALUES (r.referrer_id, 'referral_bonus', r.reward_amount, _new_bal, 'Referral reward — ' || r.referred_role || ' referral')
      RETURNING * INTO _tx;

    UPDATE public.referrals SET reward_status = 'released', reward_transaction_id = _tx.id WHERE id = r.id;

    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (r.referrer_id, 'referral_reward_released', 'Referral reward released',
            format('Your referral reward of $%s has been added to your wallet.', r.reward_amount));

    -- Milestones: count released referrals for this referrer
    SELECT count(*) INTO _count FROM public.referrals WHERE referrer_id = r.referrer_id AND reward_status = 'released';
    FOR _milestone IN SELECT jsonb_array_elements_text(COALESCE(_settings->'milestones', '[1,5,10,25,50]'::jsonb))::int LOOP
      IF _count >= _milestone AND NOT EXISTS (
        SELECT 1 FROM public.referral_milestones_achieved WHERE user_id = r.referrer_id AND milestone = _milestone
      ) THEN
        INSERT INTO public.referral_milestones_achieved (user_id, milestone) VALUES (r.referrer_id, _milestone);
        INSERT INTO public.notifications(user_id, type, title, body)
        VALUES (r.referrer_id, 'referral_milestone', format('%s referrals milestone reached!', _milestone),
                format('You''ve reached %s successful referrals. Keep sharing your code to earn more.', _milestone));
      END IF;
    END LOOP;
  END LOOP;
END $function$;

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

  -- Fraud signal: referred account shares a phone number with an existing referred account
  SELECT phone INTO _referred_phone FROM public.profiles WHERE id = _referred_id;
  IF _referred_phone IS NOT NULL THEN
    SELECT count(*) INTO _dupe_phone_count
      FROM public.referrals rf JOIN public.profiles p ON p.id = rf.referred_id
      WHERE p.phone = _referred_phone AND rf.referred_id <> _referred_id;
    IF _dupe_phone_count > 0 THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'phone number reused across referred accounts');
    END IF;
  END IF;

  -- Fraud signal: device fingerprint reused across referred accounts
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
    format('A new %s signed up using your referral code. You''ll earn a reward once they complete the requirements.', _referred_role));

  RETURN _row;
END $function$;

grant insert, update, delete on public.referrals to authenticated;
grant select on public.referrals to anon;
