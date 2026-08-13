-- 0034: The admin Settings "Price multiplier" field was wired to the wrong
-- state: it loaded its starting value from diesel_price_per_liter ($1.87)
-- but saved via admin_set_demand_multiplier -- a completely different
-- setting meant to be a small relative adjustment (e.g. 1.08 for "diesel up
-- 8%"), not an absolute dollar figure. The owner set what they believed was
-- the diesel price (a correct, real value) and it silently became an 87%
-- markup on every enforced material's cost instead. Confirmed with the
-- owner this was unintentional -- resetting to 1.0 (no change).
--
-- The actual diesel_price_per_liter setting (used correctly elsewhere, e.g.
-- long-haul transport cost) is untouched by this migration -- it was
-- already correct at $1.87 and admin_set_diesel_price was simply never
-- wired up to any UI control.

UPDATE public.material_prices
SET demand_multiplier = 1.0,
    updated_at = now()
WHERE enforced = true AND demand_multiplier <> 1.0;

-- admin_set_diesel_price existed in an earlier migration
-- (20260721194720_f18c2a25) but is missing from the live database --
-- another instance of the git/DB drift documented in CLAUDE.md. Recreating
-- it here (idempotent) since the settings screen fix below now calls it.
CREATE OR REPLACE FUNCTION public.admin_set_diesel_price(_price numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change diesel price';
  END IF;
  IF _price <= 0 OR _price > 100 THEN RAISE EXCEPTION 'Price must be between 0 and 100'; END IF;
  INSERT INTO public.system_settings(key, value, updated_by, updated_at)
  VALUES ('diesel_price_per_liter', to_jsonb(_price), auth.uid(), now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_admin_action('diesel_price_changed', NULL, NULL,
    jsonb_build_object('price', _price), NULL);
  RETURN to_jsonb(_price);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_diesel_price(numeric) TO authenticated;
