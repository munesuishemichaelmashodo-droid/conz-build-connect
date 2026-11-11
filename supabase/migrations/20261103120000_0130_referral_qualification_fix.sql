-- -----------------------------------------------------------------------------
-- 0130: make referral rewards qualify and process the way the policy intends.
--
-- Confirmed defects in process_referral_lifecycle() (live body checked 03/11/2026):
--   1. A referred CUSTOMER only qualified if one of their completed jobs had a
--      payments row with status 'paid'. Customers who pay the driver directly have no
--      payments row, and Con Z Pay payments move to 'released' once the job completes
--      (0063), so in practice nobody qualified.
--   2. A referral an admin moved to 'approved' was never picked up again: if it had not
--      qualified yet (no reward amount) it stayed stuck, and if it had, it waited for a
--      manual "release".
--   3. The three loops did not lock rows, so two overlapping runs could pay one reward twice.
--
-- What changes (policy, amounts, hold period and milestones are untouched):
--   * Customer track: the referred customer's job is 'completed'. Completion already needs the
--     delivery photo and the one-time delivery code on the server (0096) for BOTH payment
--     methods, so no ConZ payment record is needed. Two extra guards: the delivering driver
--     is not the referrer, and the job has no open dispute.
--   * 'approved' (an admin cleared the referral) is treated like 'pending' while it has not
--     qualified, and like 'hold' once it has (released when the hold period ends).
--   * Each loop takes FOR UPDATE SKIP LOCKED, so a reward is credited once however many
--     runs overlap.
-- Payment confirmation and delivery verification stay separate. No DROP.
-- Undo: supabase/rollbacks/20261103120000_0130_rollback.sql (exact live body of 03/11/2026).
-- -----------------------------------------------------------------------------

begin;

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

  -- ---- Customer track: first completed (server-verified) delivery, either payment method ----
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
        AND NOT EXISTS (
          SELECT 1 FROM public.disputes d WHERE d.job_id = j.id AND d.status IN ('open', 'investigating')
        )
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
      AND rf.reward_status IN ('pending', 'approved') AND NOT rf.fraud_flag
    FOR UPDATE SKIP LOCKED
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

  -- ---- Release rewards whose hold period has passed (held, or approved by an admin after qualifying) ----
  FOR r IN
    SELECT * FROM public.referrals
    WHERE reward_status IN ('hold', 'approved') AND reward_amount IS NOT NULL AND NOT fraud_flag
      AND reward_release_at IS NOT NULL AND reward_release_at <= now()
    FOR UPDATE SKIP LOCKED
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

commit;
