-- Recovery for 0182 — forward-safe. Run in the SQL editor only if 0182 causes a problem in production.
--
-- This script deliberately does NOT reopen ratings: the "two parties and admins" read policies stay, signed-out
-- visitors stay unable to read ratings, and signed-in users stay unable to edit or delete them.
-- The only part it reverses is the change most likely to misbehave: the two rating-average triggers go back to
-- their previous bodies (they run as the caller). With those bodies the averages stop updating, which is how
-- production was before 0182; no rating row is changed or removed, and the averages already written stay.
-- If a 0182 rule is wrong, fix it forward with a new migration.

CREATE OR REPLACE FUNCTION public.tg_rating_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE _avg NUMERIC; _cnt INT;
BEGIN
  SELECT ROUND(AVG((quality+communication+reliability+delivery_time)/4.0)::numeric,2), COUNT(*)
    INTO _avg, _cnt FROM public.ratings WHERE driver_id=NEW.driver_id;
  UPDATE public.driver_profiles SET rating_avg=_avg, rating_count=_cnt WHERE user_id=NEW.driver_id;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_customer_rating_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE _avg numeric; _cnt int;
BEGIN
  SELECT ROUND(AVG(overall)::numeric, 2), COUNT(*)
    INTO _avg, _cnt FROM public.customer_ratings WHERE customer_id = NEW.customer_id;
  UPDATE public.profiles SET customer_rating_avg = _avg, customer_rating_count = _cnt WHERE id = NEW.customer_id;
  RETURN NEW;
END $function$;
