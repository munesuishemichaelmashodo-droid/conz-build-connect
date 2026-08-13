-- 0033 (revised): tg_validate_job_budget was comparing the total job budget
-- to material_prices.min_price/max_price directly. Since the 0030 migration
-- moved real pricing to load-size buckets (material_price_buckets) plus a
-- distance-based transport component -- computed by compute_material_offer,
-- the same RPC the booking quote screen calls -- the trigger's numbers no
-- longer matched what the customer was actually quoted. A customer could
-- see "$400 for 12 m3, $314 material + $83 transport" on screen and then
-- have that exact amount rejected as "outside $12-$16" on submit.
--
-- Fix: the trigger now calls compute_material_offer itself (using a
-- haversine distance from pickup/delivery coords, same 15km default the
-- quote screen uses when coords are missing) so validation always uses the
-- exact same numbers the customer was quoted -- one source of truth instead
-- of two formulas that can drift apart.

CREATE OR REPLACE FUNCTION public.tg_validate_job_budget()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  _mp public.material_prices;
  _distance_km numeric;
  _offer jsonb;
  _min numeric;
  _max numeric;
BEGIN
  SELECT * INTO _mp FROM public.material_prices WHERE material = NEW.material;
  IF _mp IS NULL OR NOT _mp.enforced THEN RETURN NEW; END IF;
  IF NEW.budget IS NULL THEN RETURN NEW; END IF;

  IF NEW.pickup_lat IS NOT NULL AND NEW.pickup_lng IS NOT NULL
     AND NEW.delivery_lat IS NOT NULL AND NEW.delivery_lng IS NOT NULL THEN
    _distance_km := 2 * 6371 * asin(sqrt(
      power(sin(radians(NEW.delivery_lat - NEW.pickup_lat) / 2), 2) +
      cos(radians(NEW.pickup_lat)) * cos(radians(NEW.delivery_lat)) *
      power(sin(radians(NEW.delivery_lng - NEW.pickup_lng) / 2), 2)
    ));
  ELSE
    _distance_km := 15;
  END IF;

  _offer := public.compute_material_offer(NEW.material, NEW.quantity_m3, _distance_km);

  IF (_offer->>'enforced')::boolean IS NOT TRUE THEN RETURN NEW; END IF;
  IF _offer->>'min' IS NULL OR _offer->>'max' IS NULL THEN RETURN NEW; END IF;

  _min := (_offer->>'min')::numeric;
  _max := (_offer->>'max')::numeric;

  IF NEW.budget < _min OR NEW.budget > _max THEN
    RAISE EXCEPTION 'Budget $% is outside the allowed range for % ($%-$% for % m³ at ~%km)',
      NEW.budget, _mp.label, _min, _max, NEW.quantity_m3, round(_distance_km);
  END IF;
  RETURN NEW;
END $$;
