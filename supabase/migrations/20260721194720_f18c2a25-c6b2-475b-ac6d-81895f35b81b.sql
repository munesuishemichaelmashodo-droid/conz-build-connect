INSERT INTO public.system_settings(key, value, updated_at) VALUES ('diesel_price_per_liter', to_jsonb(1.87::numeric), now()) ON CONFLICT (key) DO NOTHING;

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