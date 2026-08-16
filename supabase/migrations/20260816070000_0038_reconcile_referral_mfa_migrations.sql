-- 0038: Reconciles 8 migrations that were applied live but never committed
-- (same drift pattern documented in CLAUDE.md, now caught on the
-- referral/MFA/wallet-hardening work from 14-15/08): wallet_admin_security_hardening,
-- referral_system_enum_value, referral_rewards_system, referral_rewards_rpcs,
-- mfa_step_up_for_admin_actions, mfa_recovery_system, mfa_recovery_log,
-- mfa_emergency_recovery.
--
-- Written from direct introspection of what's actually live (tables, columns,
-- constraints, indexes, RLS policies, functions) as of 16/08/2026 -- not a
-- reconstruction of original migration history. Every statement is
-- defensive (IF NOT EXISTS / CREATE OR REPLACE / duplicate_object-safe) so
-- this is safe to replay against a fresh DB or the current live one.
--
-- One real bug found and fixed along the way: admin_reset_mfa (the function
-- actually wired to admin.security.tsx) inserted into mfa_recovery_log using
-- a column name (performed_by) that doesn't exist on that table -- the real
-- column is actor_id. This meant the live "reset another admin's MFA"
-- feature would error out the instant anyone used it. Fixed below.
-- admin_reset_mfa_factor exists as unused, more complete alternative code
-- (grants a temporary recovery window instead of just deleting factors) --
-- left as-is, not wired up, flagged as a later cleanup decision rather than
-- silently switching which function the UI calls.

-- ============ tx_type enum addition ============
DO $$ BEGIN
  ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'referral_bonus';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============ New tables ============
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id),
  referred_id uuid NOT NULL UNIQUE REFERENCES auth.users(id),
  referral_code text NOT NULL,
  referred_role text NOT NULL CHECK (referred_role IN ('customer','driver')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected')),
  reward_status text NOT NULL DEFAULT 'pending' CHECK (reward_status IN ('pending','hold','approved','released','rejected','frozen')),
  reward_amount numeric,
  reward_release_at timestamptz,
  hold_period_days integer NOT NULL DEFAULT 7,
  fraud_flag boolean NOT NULL DEFAULT false,
  fraud_reason text,
  admin_notes text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  device_fingerprint text,
  reward_transaction_id uuid REFERENCES public.wallet_transactions(id),
  referred_credit_transaction_id uuid REFERENCES public.wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_check CHECK (referrer_id <> referred_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_reward_status ON public.referrals(reward_status);
CREATE INDEX IF NOT EXISTS idx_referrals_verification_status ON public.referrals(verification_status);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users read own referrals as referrer" ON public.referrals FOR SELECT USING (referrer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users read own referral as referred" ON public.referrals FOR SELECT USING (referred_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins read all referrals" ON public.referrals FOR SELECT USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.referral_milestones_achieved (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  milestone integer NOT NULL,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, milestone)
);
ALTER TABLE public.referral_milestones_achieved ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users read own milestones" ON public.referral_milestones_achieved FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins read all milestones" ON public.referral_milestones_achieved FOR SELECT USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user ON public.mfa_recovery_codes(user_id) WHERE used_at IS NULL;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see only whether their own codes exist" ON public.mfa_recovery_codes FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mfa_recovery_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  granted_via text NOT NULL CHECK (granted_via IN ('backup_code','super_admin_reset')),
  granted_by uuid REFERENCES auth.users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
ALTER TABLE public.mfa_recovery_grants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Users see own recovery grants" ON public.mfa_recovery_grants FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins see all recovery grants" ON public.mfa_recovery_grants FOR SELECT USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.mfa_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  target_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL,
  factors_removed integer NOT NULL,
  ip_address text,
  device_info jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mfa_recovery_log ENABLE ROW LEVEL SECURITY;
-- Note: two near-identical read policies existed live from two of the four
-- MFA migrations both setting this up independently; collapsed to one here.
DROP POLICY IF EXISTS "Super admins read recovery log" ON public.mfa_recovery_log;
DROP POLICY IF EXISTS "Super admins read the MFA recovery log" ON public.mfa_recovery_log;
CREATE POLICY "Super admins read the MFA recovery log" ON public.mfa_recovery_log FOR SELECT USING (has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public.prevent_mfa_recovery_log_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'mfa_recovery_log rows are immutable';
END $$;
DROP TRIGGER IF EXISTS trg_mfa_recovery_log_immutable_upd ON public.mfa_recovery_log;
CREATE TRIGGER trg_mfa_recovery_log_immutable_upd BEFORE UPDATE ON public.mfa_recovery_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mfa_recovery_log_mutation();
DROP TRIGGER IF EXISTS trg_mfa_recovery_log_immutable_del ON public.mfa_recovery_log;
CREATE TRIGGER trg_mfa_recovery_log_immutable_del BEFORE DELETE ON public.mfa_recovery_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mfa_recovery_log_mutation();

CREATE OR REPLACE FUNCTION public.prevent_referral_core_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.referrer_id <> OLD.referrer_id OR NEW.referred_id <> OLD.referred_id
     OR NEW.referral_code <> OLD.referral_code OR NEW.registered_at <> OLD.registered_at THEN
    RAISE EXCEPTION 'Core referral facts cannot be changed';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_referrals_core_immutable ON public.referrals;
DROP TRIGGER IF EXISTS trg_referrals_protect_core ON public.referrals;
CREATE TRIGGER trg_referrals_protect_core BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.prevent_referral_core_mutation();

CREATE OR REPLACE FUNCTION public.tg_touch_referrals_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS t_referrals_updated ON public.referrals;
CREATE TRIGGER t_referrals_updated BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_referrals_updated_at();

-- ============ profiles.referral_code + assignment trigger ============
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _code text; _tries int := 0;
BEGIN
  LOOP
    _code := 'CONZ-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 2)) ||
             lpad((100 + floor(random()*900))::int::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = _code);
    _tries := _tries + 1;
    IF _tries > 20 THEN RAISE EXCEPTION 'Could not generate a unique referral code'; END IF;
  END LOOP;
  RETURN _code;
END $$;

CREATE OR REPLACE FUNCTION public.tg_assign_referral_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_assign_referral_code ON public.profiles;
CREATE TRIGGER trg_assign_referral_code BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_referral_code();

CREATE OR REPLACE FUNCTION public.admin_referral_stats()
RETURNS TABLE(total_referrals bigint, pending_rewards bigint, released_rewards bigint, rejected_rewards bigint, fraud_alerts bigint, total_released_amount numeric)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    (SELECT count(*) FROM public.referrals),
    (SELECT count(*) FROM public.referrals WHERE reward_status IN ('pending','hold')),
    (SELECT count(*) FROM public.referrals WHERE reward_status = 'released'),
    (SELECT count(*) FROM public.referrals WHERE reward_status = 'rejected'),
    (SELECT count(*) FROM public.referrals WHERE fraud_flag = true),
    (SELECT COALESCE(sum(reward_amount),0) FROM public.referrals WHERE reward_status = 'released')
  WHERE (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
$$;

CREATE OR REPLACE FUNCTION public.admin_referral_action(_referral_id uuid, _action text, _notes text DEFAULT NULL::text)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _r public.referrals; _new_bal numeric; _tx public.wallet_transactions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM public.require_admin_mfa();
  IF _action NOT IN ('approve','reject','freeze','release','unfreeze') THEN RAISE EXCEPTION 'Invalid action'; END IF;

  SELECT * INTO _r FROM public.referrals WHERE id = _referral_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Referral not found'; END IF;

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
    INSERT INTO public.wallets(user_id, balance) VALUES (_r.referrer_id, 0) ON CONFLICT (user_id) DO NOTHING;
    UPDATE public.wallets SET balance = balance + _r.reward_amount, updated_at = now() WHERE user_id = _r.referrer_id RETURNING balance INTO _new_bal;
    INSERT INTO public.wallet_transactions (user_id, type, amount, balance_after, note) VALUES (_r.referrer_id, 'referral_bonus', _r.reward_amount, _new_bal, 'Referral reward — released by admin') RETURNING * INTO _tx;
    UPDATE public.referrals SET reward_status = 'released', reward_transaction_id = _tx.id, admin_notes = COALESCE(_notes, admin_notes), decided_by = auth.uid(), decided_at = now() WHERE id = _referral_id RETURNING * INTO _r;
    INSERT INTO public.notifications(user_id, type, title, body) VALUES (_r.referrer_id, 'referral_reward_released', 'Referral reward released', format('Your referral reward of $%s has been added to your wallet.', _r.reward_amount));
  END IF;

  PERFORM public.log_admin_action('referral_' || _action, jsonb_build_object('referral_id', _referral_id, 'notes', _notes), _notes, _referral_id, _r.referrer_id);
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_admins_mfa_status()
RETURNS TABLE(user_id uuid, full_name text, email text, role text, has_verified_mfa boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.full_name, p.email, ur.role::text,
    EXISTS (SELECT 1 FROM auth.mfa_factors mf WHERE mf.user_id = p.id AND mf.status = 'verified')
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('admin','super_admin')
  WHERE public.has_role(auth.uid(),'super_admin')
  ORDER BY ur.role DESC, p.full_name;
$$;

-- FIX: original live version inserted using a column name (performed_by)
-- that doesn't exist on mfa_recovery_log (the real column is actor_id) --
-- this function would have errored on every real call.
CREATE OR REPLACE FUNCTION public.admin_reset_mfa(_user_id uuid, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _removed int;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can perform an MFA recovery reset';
  END IF;
  IF public.session_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED: verify your own authenticator code before resetting another admin''s MFA';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use the standard re-enrollment flow to reset your own factor, not emergency recovery';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A written reason is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  DELETE FROM auth.mfa_factors WHERE user_id = _user_id;
  GET DIAGNOSTICS _removed = ROW_COUNT;

  INSERT INTO public.mfa_recovery_log (target_user_id, actor_id, reason, factors_removed)
  VALUES (_user_id, auth.uid(), _reason, _removed);

  PERFORM public.log_admin_action(
    'mfa_emergency_reset',
    jsonb_build_object('target_user_id', _user_id, 'factors_removed', _removed),
    _reason, _user_id, _user_id
  );

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (
    _user_id, 'mfa_reset_by_admin', 'Your two-factor authentication was reset',
    format('A super admin reset your authenticator app access. Reason: %s. You will need to re-enroll next time you access admin pages. If this was not expected, contact them immediately.', _reason)
  );

  RETURN _removed;
END $$;

CREATE OR REPLACE FUNCTION public.admin_reset_mfa_factor(_target_user_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _factor_count int;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can reset another admin''s MFA';
  END IF;
  IF public.session_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED: verify your own authenticator app before resetting someone else''s';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A written reason is required';
  END IF;
  IF _target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Use your own backup codes to reset your own MFA';
  END IF;

  DELETE FROM auth.mfa_factors WHERE user_id = _target_user_id;
  GET DIAGNOSTICS _factor_count = ROW_COUNT;

  DELETE FROM public.mfa_recovery_codes WHERE user_id = _target_user_id;
  UPDATE public.mfa_recovery_grants SET revoked = true WHERE user_id = _target_user_id AND NOT revoked;

  INSERT INTO public.mfa_recovery_grants (user_id, reason, granted_via, granted_by, expires_at)
  VALUES (_target_user_id, _reason, 'super_admin_reset', auth.uid(), now() + interval '2 hours');

  PERFORM public.log_admin_action('mfa_factor_reset_by_super_admin',
    jsonb_build_object('factors_removed', _factor_count), _reason, _target_user_id, _target_user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_target_user_id, 'mfa_reset', 'Your MFA was reset',
    format('A super admin reset your two-factor authentication. Reason: %s. Please re-enroll your authenticator app.', _reason));
END $$;

-- ============ wallet_transactions hardening columns + enum ============
DO $$ BEGIN
  CREATE TYPE wallet_adjustment_category AS ENUM ('refund','promotion','dispute_resolution','payment_correction','escrow_adjustment','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS category wallet_adjustment_category,
  ADD COLUMN IF NOT EXISTS previous_balance numeric,
  ADD COLUMN IF NOT EXISTS reversal_of_transaction_id uuid REFERENCES public.wallet_transactions(id),
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS device_info jsonb;

CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(_user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text, _ip text DEFAULT NULL::text, _device jsonb DEFAULT '{}'::jsonb)
RETURNS wallet_transactions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _is_super boolean; _threshold numeric; _prev_bal numeric; _new_bal numeric; _tx public.wallet_transactions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  PERFORM public.require_admin_mfa();
  IF _amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'A written reason is required'; END IF;

  _is_super := public.has_role(auth.uid(),'super_admin');
  SELECT COALESCE((value->>'threshold')::numeric, 500) INTO _threshold FROM public.system_settings WHERE key = 'admin_wallet_threshold';
  IF _threshold IS NULL THEN _threshold := 500; END IF;
  IF abs(_amount) > _threshold AND NOT _is_super THEN
    RAISE EXCEPTION 'Amounts over % require super admin approval', _threshold;
  END IF;

  INSERT INTO public.wallets(user_id, balance) VALUES (_user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO _prev_bal FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  _new_bal := _prev_bal + _amount;
  IF _new_bal < 0 THEN RAISE EXCEPTION 'This deduction would take the wallet negative (balance %, deduct %)', _prev_bal, abs(_amount); END IF;

  UPDATE public.wallets SET balance = _new_bal, updated_at = now(), limited = false WHERE user_id = _user_id;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount, balance_after, previous_balance, category, note, created_by, ip_address, device_info)
  VALUES (_user_id, 'adjustment', _amount, _new_bal, _prev_bal, _category, _reason, auth.uid(), _ip, _device)
  RETURNING * INTO _tx;

  PERFORM public.log_admin_action(
    CASE WHEN _amount > 0 THEN 'wallet_credited_by_admin' ELSE 'wallet_debited_by_admin' END,
    jsonb_build_object('amount', _amount, 'category', _category, 'previous_balance', _prev_bal, 'new_balance', _new_bal, 'ip', _ip, 'device', _device),
    _reason, _tx.id, _user_id
  );

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_user_id, 'wallet_adjustment',
    CASE WHEN _amount > 0 THEN 'Wallet credited' ELSE 'Wallet debited' END,
    format('Your wallet was %s $%s. Reason: %s', CASE WHEN _amount > 0 THEN 'credited with' ELSE 'debited by' END, to_char(abs(_amount), 'FM999999990.00'), _reason));

  RETURN _tx;
END $$;

CREATE OR REPLACE FUNCTION public.admin_wallet_reverse(_transaction_id uuid, _reason text)
RETURNS wallet_transactions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _orig public.wallet_transactions; _already_reversed boolean; _prev_bal numeric; _new_bal numeric; _tx public.wallet_transactions;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'Only super admins can reverse transactions'; END IF;
  PERFORM public.require_admin_mfa();
  IF _reason IS NULL OR btrim(_reason) = '' THEN RAISE EXCEPTION 'A written reason is required'; END IF;

  SELECT * INTO _orig FROM public.wallet_transactions WHERE id = _transaction_id;
  IF _orig IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF _orig.type <> 'adjustment' THEN RAISE EXCEPTION 'Only admin credit/deduct adjustments can be reversed'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.wallet_transactions WHERE reversal_of_transaction_id = _orig.id) INTO _already_reversed;
  IF _already_reversed THEN RAISE EXCEPTION 'This transaction has already been reversed'; END IF;

  SELECT balance INTO _prev_bal FROM public.wallets WHERE user_id = _orig.user_id FOR UPDATE;
  _new_bal := _prev_bal - _orig.amount;
  IF _new_bal < 0 THEN RAISE EXCEPTION 'Reversal would take the wallet negative'; END IF;
  UPDATE public.wallets SET balance = _new_bal, updated_at = now() WHERE user_id = _orig.user_id;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount, balance_after, previous_balance, category, note, created_by, reversal_of_transaction_id)
  VALUES (_orig.user_id, 'adjustment', -_orig.amount, _new_bal, _prev_bal, _orig.category, 'Reversal: '||_reason, auth.uid(), _orig.id)
  RETURNING * INTO _tx;

  PERFORM public.log_admin_action('wallet_transaction_reversed',
    jsonb_build_object('original_transaction_id', _orig.id, 'amount', -_orig.amount, 'new_balance', _new_bal), _reason, _tx.id, _orig.user_id);

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_orig.user_id, 'wallet_adjustment_reversed', 'Wallet adjustment reversed',
    format('A previous wallet adjustment of $%s was reversed. Reason: %s', to_char(abs(_orig.amount),'FM999999990.00'), _reason));

  RETURN _tx;
END $$;

-- ============ Core MFA step-up primitives ============
-- These are the two functions everything else in this file (and 0037,
-- already committed) depends on -- reconciling them here since
-- mfa_step_up_for_admin_actions was itself one of the 8 live-only
-- migrations.
CREATE OR REPLACE FUNCTION public.session_aal()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.jwt()->>'aal', 'aal1');
$$;

CREATE OR REPLACE FUNCTION public.require_admin_mfa()
RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RETURN;
  END IF;
  IF public.session_aal() = 'aal2' THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.mfa_recovery_grants
    WHERE user_id = auth.uid() AND NOT revoked AND expires_at > now()
  ) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'MFA_REQUIRED: this action requires a verified authenticator app code';
END $$;

CREATE OR REPLACE FUNCTION public.generate_mfa_recovery_codes()
RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _codes text[] := '{}';
  _code text;
  i int;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF public.session_aal() <> 'aal2' THEN
    RAISE EXCEPTION 'MFA_REQUIRED: verify your authenticator app before generating backup codes';
  END IF;

  DELETE FROM public.mfa_recovery_codes WHERE user_id = auth.uid();

  FOR i IN 1..10 LOOP
    _code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4)) || '-' ||
             upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    _codes := array_append(_codes, _code);
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash) VALUES (auth.uid(), crypt(_code, gen_salt('bf')));
  END LOOP;

  PERFORM public.log_admin_action('mfa_recovery_codes_generated', jsonb_build_object('count', 10), NULL, NULL, auth.uid());
  RETURN _codes;
END $$;

CREATE OR REPLACE FUNCTION public.redeem_mfa_recovery_code(_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _match record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Must be authenticated'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO _match FROM public.mfa_recovery_codes
    WHERE user_id = auth.uid() AND used_at IS NULL AND code_hash = crypt(_code, code_hash)
    LIMIT 1;
  IF _match IS NULL THEN
    RAISE EXCEPTION 'Invalid or already-used recovery code';
  END IF;

  UPDATE public.mfa_recovery_codes SET used_at = now() WHERE id = _match.id;

  INSERT INTO public.mfa_recovery_grants (user_id, reason, granted_via, granted_by, expires_at)
  VALUES (auth.uid(), 'Backup code redeemed — authenticator unavailable', 'backup_code', auth.uid(), now() + interval '2 hours');

  PERFORM public.log_admin_action('mfa_recovery_code_redeemed',
    jsonb_build_object('recovery_code_id', _match.id), 'Backup code used to bypass MFA', _match.id, auth.uid());

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (auth.uid(), 'mfa_recovery_used', 'Backup code used',
    'A backup code was used to access admin features without your authenticator app. If this wasn''t you, contact another super admin immediately.');
END $$;

-- ============ referral_rewards settings default ============
-- Live value already matches these defaults exactly (hold_days: 7,
-- customer_referrer_amount: 10, customer_referred_credit: 5,
-- driver_referrer_amount: 15, driver_min_deliveries: 5,
-- milestones: [1,5,10,25,50]) -- inserted defensively, never overwrites.
INSERT INTO public.system_settings(key, value)
VALUES ('referral_rewards', '{"hold_days":7,"customer_referrer_amount":10,"customer_referred_credit":5,"driver_referrer_amount":15,"driver_min_deliveries":5,"milestones":[1,5,10,25,50]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============ Core referral functions ============
CREATE OR REPLACE FUNCTION public.record_referral(_code text, _referred_role text DEFAULT 'customer'::text, _device_fingerprint text DEFAULT NULL::text)
RETURNS referrals LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.process_referral_lifecycle()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

-- ============ Scheduled job ============
-- Confirmed live: runs every 15 minutes. Registered defensively -- unschedule
-- any existing job of the same name first so this is safe to replay.
DO $$
BEGIN
  PERFORM cron.unschedule('process-referral-rewards');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('process-referral-rewards', '*/15 * * * *', 'select public.process_referral_lifecycle();');
