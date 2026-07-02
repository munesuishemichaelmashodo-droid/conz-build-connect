
ALTER TABLE public.material_prices
  ADD COLUMN IF NOT EXISTS demand_multiplier numeric NOT NULL DEFAULT 1.0;

-- Server-side offer computation (uses the current price guide; runs as definer)
CREATE OR REPLACE FUNCTION public.compute_material_offer(
  _material public.material_category,
  _quantity numeric,
  _distance_km numeric
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mp public.material_prices;
  _mid numeric;
  _qty_factor numeric;
  _dist_factor numeric;
  _raw numeric;
  _step int;
  _offer numeric;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = _material;
  IF _mp IS NULL OR NOT _mp.enforced THEN
    RETURN jsonb_build_object(
      'offer', NULL,
      'min', NULL,
      'max', NULL,
      'step', 5,
      'enforced', false
    );
  END IF;

  _mid := (_mp.min_price + _mp.max_price) / 2.0;

  -- Quantity factor: 10m³ → 0.9, 12.5m³ → 1.0, 15m³ → 1.1 (linear)
  _qty_factor := 0.9 + ((COALESCE(_quantity, 12.5) - 10) / 5.0) * 0.2;
  _qty_factor := GREATEST(0.85, LEAST(1.15, _qty_factor));

  -- Distance factor: 0km → 0.92, 15km → 1.0, 30km → 1.08 (linear)
  _dist_factor := 0.92 + (COALESCE(_distance_km, 15) / 15.0) * 0.08;
  _dist_factor := GREATEST(0.9, LEAST(1.15, _dist_factor));

  _raw := _mid * _qty_factor * _dist_factor * COALESCE(_mp.demand_multiplier, 1.0);
  _raw := GREATEST(_mp.min_price, LEAST(_mp.max_price, _raw));

  IF _raw < 100 THEN _step := 5;
  ELSIF _raw < 300 THEN _step := 10;
  ELSE _step := 20;
  END IF;

  _offer := ROUND(_raw / _step) * _step;
  _offer := GREATEST(_mp.min_price, LEAST(_mp.max_price, _offer));

  RETURN jsonb_build_object(
    'offer', _offer,
    'min', _mp.min_price,
    'max', _mp.max_price,
    'step', _step,
    'label', _mp.label,
    'unit', _mp.unit,
    'enforced', true
  );
END $$;

GRANT EXECUTE ON FUNCTION public.compute_material_offer(public.material_category, numeric, numeric) TO authenticated, anon;
