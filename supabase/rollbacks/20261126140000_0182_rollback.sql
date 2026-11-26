-- Undo 0182: restores the rating policies, grants and average triggers exactly as they were live on 26/11/2026.
-- WARNING: this re-opens every rating row to every signed-in user and brings back averages that never update.
-- The one-off recompute in 0182 is not undone (it only corrected figures to match the ratings that exist).

alter policy "Ratings readable by the two parties and admins" on public.ratings using (true);
alter policy "Ratings readable by the two parties and admins" on public.ratings rename to "Ratings readable by authenticated";

alter policy "Customer ratings readable by the two parties and admins" on public.customer_ratings using (true);
alter policy "Customer ratings readable by the two parties and admins" on public.customer_ratings rename to "Authenticated can read customer ratings";

grant select on public.ratings, public.customer_ratings to anon;
grant update, delete on public.ratings, public.customer_ratings to authenticated;

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
