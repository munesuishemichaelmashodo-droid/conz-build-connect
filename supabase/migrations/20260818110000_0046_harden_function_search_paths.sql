-- Security hardening: 8 functions were missing an explicit search_path,
-- flagged by the Supabase security advisor. Without SET search_path,
-- an unqualified reference inside the function resolves against
-- whatever search_path the calling session has, which (in the
-- SECURITY DEFINER cases especially) is a "search_path hijacking"
-- risk: a caller could in principle create a same-named object earlier
-- in their own search_path to have it picked up instead of the
-- intended one. None of these had an active exploit found in this
-- review, but pinning search_path is a standard, low-risk hardening
-- step. Logic is unchanged in every case -- confirmed by pulling each
-- function's live definition first (prevent_wallet_tx_mutation existed
-- live but had never been captured into a migration file -- recorded
-- here too, so migration history matches the live schema).
CREATE OR REPLACE FUNCTION public.session_aal()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(auth.jwt()->>'aal', 'aal1');
$function$;

CREATE OR REPLACE FUNCTION public.driver_level_commission_multiplier(_level driver_level)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _level
    WHEN 'platinum' THEN 0.80  -- 20% off commission
    WHEN 'gold'     THEN 0.90  -- 10% off commission
    WHEN 'silver'   THEN 0.95  -- 5% off commission
    ELSE 1.00                  -- bronze: full rate
  END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_wallet_tx_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'wallet_transactions rows are immutable and cannot be updated or deleted';
END $function$;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _code text;
  _tries int := 0;
BEGIN
  LOOP
    _code := 'CONZ-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 2)) ||
             lpad((100 + floor(random()*900))::int::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = _code);
    _tries := _tries + 1;
    IF _tries > 20 THEN RAISE EXCEPTION 'Could not generate a unique referral code'; END IF;
  END LOOP;
  RETURN _code;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_assign_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.generate_referral_code();
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_touch_referrals_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.prevent_referral_core_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.referrer_id <> OLD.referrer_id OR NEW.referred_id <> OLD.referred_id
     OR NEW.referral_code <> OLD.referral_code OR NEW.registered_at <> OLD.registered_at THEN
    RAISE EXCEPTION 'Core referral facts cannot be changed';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.prevent_mfa_recovery_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'mfa_recovery_log rows are immutable';
END $function$;
