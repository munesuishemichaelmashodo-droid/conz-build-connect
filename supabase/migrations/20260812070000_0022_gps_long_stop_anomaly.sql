-- GPS anomaly detection (long-stop only, v1): turns live GPS tracking from
-- a passive map into an active safety signal, similar in spirit to Uber's
-- RideCheck. Route-deviation detection is NOT included here — that needs
-- a stored planned route to compare against, which Con Z doesn't persist
-- today (routes are computed client-side via OSRM on demand); a future
-- version could add it once a route is stored per job.
--
-- Only checked while status = 'in_progress' (truck loaded, en route to
-- delivery) — a long stop while 'accepted' is normal (loading at pickup),
-- not anomalous.
--
-- Applied live to ovwrsocjmkpiygipmrdk already and verified against a
-- scratch job (long stop past 20 min fired exactly one alert to the
-- customer + admins and one location_anomalies row; a >100m move reset
-- the clock; test rows cleaned up after). Recorded here so migration
-- history matches the live schema.

ALTER TABLE public.driver_locations
  ADD COLUMN IF NOT EXISTS stationary_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anomaly_alerted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.location_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL,
  kind TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  stationary_minutes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.location_anomalies TO authenticated;
GRANT ALL ON public.location_anomalies TO service_role;
ALTER TABLE public.location_anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Location anomalies visible to job parties" ON public.location_anomalies FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = location_anomalies.job_id AND (j.customer_id = auth.uid() OR j.driver_id = auth.uid()))
  OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
);
-- No INSERT/UPDATE policy for authenticated: only the SECURITY DEFINER
-- trigger function below writes to this table, same pattern as the
-- existing tg_notify_new_job_posted trigger.

CREATE OR REPLACE FUNCTION public.tg_check_location_anomaly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status public.job_status;
  v_moved_meters double precision;
  v_stationary_minutes integer;
  v_threshold_minutes constant integer := 20;
  v_move_threshold_meters constant double precision := 100;
BEGIN
  SELECT status INTO v_status FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    NEW.stationary_since := NEW.updated_at;
    NEW.anomaly_alerted_at := NULL;
    RETURN NEW;
  END IF;

  IF v_status IS DISTINCT FROM 'in_progress' THEN
    NEW.stationary_since := NULL;
    NEW.anomaly_alerted_at := NULL;
    RETURN NEW;
  END IF;

  v_moved_meters := 111320 * sqrt(
    power(NEW.lat - OLD.lat, 2) +
    power((NEW.lng - OLD.lng) * cos(radians(NEW.lat)), 2)
  );

  IF v_moved_meters > v_move_threshold_meters OR OLD.stationary_since IS NULL THEN
    -- Actually moved (or just entered in_progress) — (re)start the clock.
    NEW.stationary_since := NEW.updated_at;
    NEW.anomaly_alerted_at := NULL;
    RETURN NEW;
  END IF;

  -- Still roughly in the same spot as last ping — keep the original
  -- stationary_since so the clock doesn't reset on every 5-second ping.
  NEW.stationary_since := OLD.stationary_since;
  v_stationary_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.updated_at - NEW.stationary_since)) / 60)::integer;

  IF v_stationary_minutes >= v_threshold_minutes AND OLD.anomaly_alerted_at IS NULL THEN
    NEW.anomaly_alerted_at := NEW.updated_at;

    INSERT INTO public.location_anomalies (job_id, driver_id, kind, lat, lng, stationary_minutes)
    VALUES (NEW.job_id, NEW.driver_id, 'long_stop', NEW.lat, NEW.lng, v_stationary_minutes);

    INSERT INTO public.notifications (user_id, type, title, body, job_id)
    SELECT j.customer_id, 'delivery_stopped',
           'Your delivery hasn''t moved in a while',
           'Your driver has been stationary for about ' || v_stationary_minutes || ' minutes. Tap to check the job.',
           j.id
    FROM public.jobs j WHERE j.id = NEW.job_id;

    INSERT INTO public.notifications (user_id, type, title, body, job_id)
    SELECT ur.user_id, 'delivery_stopped',
           'Driver stationary during delivery',
           'A driver has been stationary for about ' || v_stationary_minutes || ' minutes on an in-progress job.',
           NEW.job_id
    FROM public.user_roles ur WHERE ur.role IN ('admin','super_admin');
  ELSE
    NEW.anomaly_alerted_at := OLD.anomaly_alerted_at;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS driver_locations_anomaly_check ON public.driver_locations;
CREATE TRIGGER driver_locations_anomaly_check
  BEFORE INSERT OR UPDATE ON public.driver_locations
  FOR EACH ROW EXECUTE FUNCTION public.tg_check_location_anomaly();
