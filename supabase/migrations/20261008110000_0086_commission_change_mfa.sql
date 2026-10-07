-- =============================================================================
-- 0086 — Commission rate changes require MFA (second audit, Phase 19)
-- =============================================================================
-- admin_set_commission (both overloads) changes every future payout; the owner
-- decision is that super_admin money actions require an MFA (aal2) session.
-- Bodies are the current definitions with one added line each.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_commission(_rate numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _old numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change commission';
  END IF;
  -- 0086: commission changes every future payout -> super_admin money action -> MFA.
  PERFORM public.require_aal2();
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Rate must be 0-100'; END IF;
  SELECT (value)::numeric INTO _old FROM public.system_settings WHERE key = 'commission_rate';
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('commission_rate', to_jsonb(_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('commission_changed', jsonb_build_object('old_rate', _old, 'new_rate', _rate));
  RETURN to_jsonb(_rate);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_commission(_rate numeric, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _old numeric;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change commission';
  END IF;
  -- 0086: commission changes every future payout -> super_admin money action -> MFA.
  PERFORM public.require_aal2();
  IF _rate < 0 OR _rate > 100 THEN RAISE EXCEPTION 'Rate must be 0-100'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'Give a reason for this change (at least 5 characters) — it is recorded in the audit log.';
  END IF;
  SELECT (value)::numeric INTO _old FROM public.system_settings WHERE key = 'commission_rate';
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('commission_rate', to_jsonb(_rate), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('commission_changed', jsonb_build_object('old_rate', _old, 'new_rate', _rate), _reason);
  RETURN to_jsonb(_rate);
END $function$;
