-- -----------------------------------------------------------------------------
-- 0181: referrals give non-cash recognition only (owner decision 26/11/2026).
--
-- Before (live, checked 26/11): the cron job `process-referral-rewards` (every 15 min) runs
-- process_referral_lifecycle(), which credited wallets.balance (real commission credit):
--   referrer $15 (driver) or $10 (customer) after a 7-day hold, and the referred customer $5 at once.
-- admin_referral_action('release') credited the referrer's wallet too.
-- Production had 0 referrals and 0 referral_bonus wallet transactions, so nothing was ever paid or is owed.
--
-- After:
--   * No referral path touches wallets or wallet_transactions. Qualification, the 7-day hold, admin review
--     and milestones stay; "released" now means "recognised". The referral_rewards amounts are ignored
--     (the settings row is kept as history and is not changed here).
--   * A trigger refuses any new wallet_transactions row of type 'referral_bonus', so no route (old code,
--     a manual call, a future change) can issue referral money without first removing this guard.
--   * Qualification, with 0130's fixes and stricter counting (0130 itself stays unapplied: it kept the cash):
--       customer: a completed job, not delivered by the referrer, with no open/investigating dispute;
--       driver:   verified, and at least driver_min_deliveries (5) completed jobs whose customer is not the
--                 referrer and that have no open/investigating dispute, and no open dispute against them.
--     Every loop takes FOR UPDATE SKIP LOCKED, so overlapping runs process each referral once.
--   * admin_referral_action: same actions; 'release' records recognition only (still super admin +
--     step-up, never one of the two parties); reject/freeze, and approving a fraud-flagged referral, need a reason; a recognised referral can be
--     corrected (rejected) with a reason. Every action is in admin_audit_log.
--   * record_referral: unchanged rules; its notification no longer promises a reward.
--   * Direct writes on referrals by anon/authenticated are revoked (all writers are SECURITY DEFINER;
--     RLS already had no write policy).
-- No DROP, no DELETE. Recovery (forward-safe, never restores referral money): supabase/rollbacks/20261126130000_0181_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Hard guard: no new referral money --------------------------------------------------------------------
create or replace function public.tg_wallet_tx_no_referral_money()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.type = 'referral_bonus' then
    raise exception 'Referral rewards are non-cash recognition only (0181); no wallet credit can be issued for a referral.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_wallet_tx_no_referral_money() from public, anon, authenticated;
create or replace trigger trg_wallet_tx_no_referral_money
  before insert on public.wallet_transactions
  for each row execute function public.tg_wallet_tx_no_referral_money();

-- 2. Processing: qualify, hold, recognise. Never money. ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_referral_lifecycle()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _settings jsonb;
  _driver_min_deliveries int;
  r record;
  _milestone int;
  _count int;
BEGIN
  SELECT value INTO _settings FROM public.system_settings WHERE key = 'referral_rewards';
  _driver_min_deliveries := greatest(COALESCE((_settings->>'driver_min_deliveries')::int, 5), 1);

  -- Customer track: the referred customer's first genuine completed delivery.
  FOR r IN
    SELECT rf.* FROM public.referrals rf
    WHERE rf.referred_role = 'customer' AND rf.verification_status = 'pending'
      AND rf.reward_status IN ('pending', 'approved') AND NOT rf.fraud_flag
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.customer_id = r.referred_id AND j.status = 'completed'
        AND j.driver_id IS DISTINCT FROM r.referrer_id
        AND NOT EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = j.id AND d.status IN ('open', 'investigating'))
    ) THEN
      UPDATE public.referrals
         SET verification_status = 'verified', reward_status = 'hold', reward_amount = NULL,
             reward_release_at = now() + (coalesce(r.hold_period_days, 7) || ' days')::interval
       WHERE id = r.id;
      INSERT INTO public.notifications(user_id, type, title, body)
      VALUES (r.referrer_id, 'referral_verified', 'Your referral completed their first delivery',
              format('Thank you for inviting them. Your referral will be recognised after a %s-day check.',
                     coalesce(r.hold_period_days, 7)));
    END IF;
  END LOOP;

  -- Driver track: verified, and N genuine completed jobs (not for the referrer, not under an open dispute).
  FOR r IN
    SELECT rf.* FROM public.referrals rf
    WHERE rf.referred_role = 'driver' AND rf.verification_status = 'pending'
      AND rf.reward_status IN ('pending', 'approved') AND NOT rf.fraud_flag
    FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.driver_profiles dp
      WHERE dp.user_id = r.referred_id AND dp.verification_status = 'verified'
        AND NOT EXISTS (SELECT 1 FROM public.disputes d WHERE d.against = r.referred_id AND d.status IN ('open', 'investigating'))
    ) AND (
      SELECT count(*) FROM public.jobs j
      WHERE j.driver_id = r.referred_id AND j.status = 'completed'
        AND j.customer_id IS DISTINCT FROM r.referrer_id
        AND NOT EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = j.id AND d.status IN ('open', 'investigating'))
    ) >= _driver_min_deliveries THEN
      UPDATE public.referrals
         SET verification_status = 'verified', reward_status = 'hold', reward_amount = NULL,
             reward_release_at = now() + (coalesce(r.hold_period_days, 7) || ' days')::interval
       WHERE id = r.id;
      INSERT INTO public.notifications(user_id, type, title, body)
      VALUES (r.referrer_id, 'referral_verified', 'Your referred driver met the requirements',
              format('Thank you for inviting them. Your referral will be recognised after a %s-day check.',
                     coalesce(r.hold_period_days, 7)));
    END IF;
  END LOOP;

  -- Recognition once the hold has passed (held, or approved by an admin after qualifying). No money.
  FOR r IN
    SELECT * FROM public.referrals
    WHERE reward_status IN ('hold', 'approved') AND verification_status = 'verified' AND NOT fraud_flag
      AND reward_release_at IS NOT NULL AND reward_release_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.referrals SET reward_status = 'released' WHERE id = r.id;
    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (r.referrer_id, 'referral_recognised', 'Referral recognised',
            'Your referral is now recognised and counts towards your referral milestones. Thank you for helping Con Z grow.');

    SELECT count(*) INTO _count FROM public.referrals WHERE referrer_id = r.referrer_id AND reward_status = 'released';
    FOR _milestone IN SELECT jsonb_array_elements_text(COALESCE(_settings->'milestones', '[1,5,10,25,50]'::jsonb))::int LOOP
      IF _count >= _milestone AND NOT EXISTS (
        SELECT 1 FROM public.referral_milestones_achieved WHERE user_id = r.referrer_id AND milestone = _milestone
      ) THEN
        INSERT INTO public.referral_milestones_achieved (user_id, milestone) VALUES (r.referrer_id, _milestone);
        INSERT INTO public.notifications(user_id, type, title, body)
        VALUES (r.referrer_id, 'referral_milestone', format('%s recognised referrals', _milestone),
                format('You have %s recognised referrals on Con Z.', _milestone));
      END IF;
    END LOOP;
  END LOOP;
END $function$;
revoke all on function public.process_referral_lifecycle() from public, anon, authenticated;
grant execute on function public.process_referral_lifecycle() to service_role;

-- 3. Admin review: same actions, never money ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_referral_action(_referral_id uuid, _action text, _notes text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r public.referrals;
  _reason text := nullif(btrim(coalesce(_notes, '')), '');
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN ('approve', 'reject', 'freeze', 'release', 'unfreeze') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO _r FROM public.referrals WHERE id = _referral_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Referral not found'; END IF;
  IF auth.uid() IN (_r.referrer_id, _r.referred_id) THEN
    RAISE EXCEPTION 'You cannot act on a referral you are part of.' USING ERRCODE = '42501';
  END IF;
  IF _action IN ('reject', 'freeze') AND (_reason IS NULL OR length(_reason) < 5) THEN
    RAISE EXCEPTION 'Give a reason (at least 5 characters).' USING ERRCODE = '22023';
  END IF;

  IF _action = 'approve' THEN
    IF _r.reward_status IN ('released', 'rejected') THEN RAISE EXCEPTION 'This referral is already decided (%).', _r.reward_status; END IF;
    -- Clearing a fraud flag is a decision about a person: it needs a written reason, like freezing.
    IF coalesce(_r.fraud_flag, false) AND (_reason IS NULL OR length(_reason) < 5) THEN
      RAISE EXCEPTION 'Give a reason (at least 5 characters) for clearing the fraud flag.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.referrals SET reward_status = 'approved', fraud_flag = false, admin_notes = COALESCE(_reason, admin_notes),
           decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'reject' THEN
    -- Also corrects a recognised referral: recognition carries no money, so nothing has to be reversed.
    UPDATE public.referrals SET reward_status = 'rejected', admin_notes = _reason, decided_by = auth.uid(), decided_at = now()
     WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (_r.referrer_id, 'referral_reward_rejected', 'Referral not recognised', 'Reason: ' || _reason);
  ELSIF _action = 'freeze' THEN
    IF _r.reward_status IN ('released', 'rejected') THEN RAISE EXCEPTION 'This referral is already decided (%).', _r.reward_status; END IF;
    UPDATE public.referrals SET reward_status = 'frozen', fraud_flag = true, fraud_reason = _reason, admin_notes = _reason,
           decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'unfreeze' THEN
    IF _r.reward_status <> 'frozen' THEN RAISE EXCEPTION 'Only a frozen referral can be unfrozen.'; END IF;
    UPDATE public.referrals
       SET reward_status = CASE WHEN verification_status = 'verified' THEN 'hold' ELSE 'pending' END,
           fraud_flag = false, admin_notes = COALESCE(_reason, admin_notes), decided_by = auth.uid(), decided_at = now()
     WHERE id = _referral_id RETURNING * INTO _r;
  ELSIF _action = 'release' THEN
    -- Recognise now, skipping the rest of the hold. Super admin + step-up, as before (no money any more).
    IF NOT public.has_role(auth.uid(), 'super_admin') THEN
      RAISE EXCEPTION 'Only a super admin can recognise a referral early.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.require_aal2();
    IF _r.reward_status = 'released' THEN RAISE EXCEPTION 'Already released'; END IF;
    IF _r.reward_status NOT IN ('approved', 'hold') OR coalesce(_r.fraud_flag, false) THEN
      RAISE EXCEPTION 'Only an approved, unflagged reward can be released (status %).', _r.reward_status;
    END IF;
    UPDATE public.referrals SET reward_status = 'released', admin_notes = COALESCE(_reason, admin_notes),
           decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body)
    VALUES (_r.referrer_id, 'referral_recognised', 'Referral recognised',
            'Your referral is now recognised and counts towards your referral milestones. Thank you for helping Con Z grow.');
  END IF;

  PERFORM public.log_admin_action('referral_' || _action, jsonb_build_object('referral_id', _referral_id, 'notes', _reason),
                                  _reason, _referral_id, _r.referrer_id);
  RETURN _r;
END $function$;
revoke all on function public.admin_referral_action(uuid, text, text) from public, anon;
grant execute on function public.admin_referral_action(uuid, text, text) to authenticated, service_role;

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

-- 5. No direct writes on referrals (every writer is SECURITY DEFINER; RLS already has no write policy) -----
revoke insert, update, delete, truncate on public.referrals from anon, authenticated;
revoke select on public.referrals from anon;
-- Reading stays as on production: signed-in users, limited by RLS to their own rows (admins all).
grant select on public.referrals to authenticated;
grant select, insert, update, delete on public.referrals to service_role;
