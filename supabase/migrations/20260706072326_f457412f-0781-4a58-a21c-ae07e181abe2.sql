
-- Enum for offer status
DO $$ BEGIN
  CREATE TYPE public.dispatch_offer_status AS ENUM ('pending','accepted','expired','superseded','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.job_dispatch_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wave integer NOT NULL DEFAULT 1,
  status public.dispatch_offer_status NOT NULL DEFAULT 'pending',
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 seconds'),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_jdo_driver_pending ON public.job_dispatch_offers(driver_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jdo_job ON public.job_dispatch_offers(job_id);

GRANT SELECT ON public.job_dispatch_offers TO authenticated;
GRANT ALL ON public.job_dispatch_offers TO service_role;

ALTER TABLE public.job_dispatch_offers ENABLE ROW LEVEL SECURITY;

-- Drivers see their own offers
CREATE POLICY "Drivers view own offers"
  ON public.job_dispatch_offers FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

-- Customer of job / admins see all offers for a job
CREATE POLICY "Customer/admin view job offers"
  ON public.job_dispatch_offers FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_dispatch_offers.job_id AND j.customer_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_dispatch_offers;
ALTER TABLE public.job_dispatch_offers REPLICA IDENTITY FULL;

-- Enable realtime for jobs too (used by offer components)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
EXCEPTION WHEN duplicate_object THEN NULL;
WHEN others THEN NULL; END $$;

-- Function: create next dispatch wave
CREATE OR REPLACE FUNCTION public.create_dispatch_wave(_job_id uuid, _limit int DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_wave integer;
  created_count integer := 0;
  job_row public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO job_row FROM public.jobs WHERE id = _job_id;
  IF NOT FOUND OR job_row.status <> 'open' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(MAX(wave), 0) + 1 INTO next_wave
  FROM public.job_dispatch_offers WHERE job_id = _job_id;

  -- Pick verified, available drivers not already offered this job.
  INSERT INTO public.job_dispatch_offers (job_id, driver_id, wave, expires_at)
  SELECT _job_id, ur.user_id, next_wave, now() + interval '10 seconds'
  FROM public.user_roles ur
  JOIN public.driver_profiles dp ON dp.user_id = ur.user_id
  WHERE ur.role = 'driver'
    AND dp.verification_status = 'verified'
    AND ur.user_id <> job_row.customer_id
    AND NOT EXISTS (
      SELECT 1 FROM public.job_dispatch_offers o
      WHERE o.job_id = _job_id AND o.driver_id = ur.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j2
      WHERE j2.driver_id = ur.user_id
        AND j2.status IN ('accepted','in_progress')
    )
  ORDER BY dp.rating_avg DESC NULLS LAST, dp.jobs_completed DESC
  LIMIT _limit;

  GET DIAGNOSTICS created_count = ROW_COUNT;
  RETURN created_count;
END;
$$;

-- Function: accept an offer
CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  offer_row public.job_dispatch_offers%ROWTYPE;
  job_row public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO offer_row FROM public.job_dispatch_offers WHERE id = _offer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found'; END IF;
  IF offer_row.driver_id <> auth.uid() THEN RAISE EXCEPTION 'Not your offer'; END IF;
  IF offer_row.status <> 'pending' THEN RAISE EXCEPTION 'Offer no longer available'; END IF;
  IF offer_row.expires_at < now() THEN
    UPDATE public.job_dispatch_offers SET status='expired', responded_at=now() WHERE id=_offer_id;
    RAISE EXCEPTION 'Offer expired';
  END IF;

  SELECT * INTO job_row FROM public.jobs WHERE id = offer_row.job_id FOR UPDATE;
  IF job_row.status <> 'open' THEN RAISE EXCEPTION 'Job no longer available'; END IF;

  UPDATE public.jobs
     SET driver_id = auth.uid(),
         status = 'accepted',
         final_price = COALESCE(final_price, budget)
   WHERE id = job_row.id;

  UPDATE public.job_dispatch_offers
     SET status = 'accepted', responded_at = now()
   WHERE id = _offer_id;

  UPDATE public.job_dispatch_offers
     SET status = 'superseded', responded_at = now()
   WHERE job_id = job_row.id AND id <> _offer_id AND status = 'pending';

  RETURN job_row.id;
END;
$$;

-- Function: expire stale offers and roll to next wave if still open
CREATE OR REPLACE FUNCTION public.expire_stale_dispatch_offers(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
  job_status text;
  waves_sent integer := 0;
BEGIN
  UPDATE public.job_dispatch_offers
     SET status = 'expired', responded_at = now()
   WHERE job_id = _job_id AND status = 'pending' AND expires_at < now();

  SELECT status INTO job_status FROM public.jobs WHERE id = _job_id;
  IF job_status <> 'open' THEN RETURN 0; END IF;

  SELECT COUNT(*) INTO remaining
  FROM public.job_dispatch_offers
  WHERE job_id = _job_id AND status = 'pending';

  IF remaining = 0 THEN
    waves_sent := public.create_dispatch_wave(_job_id, 5);
  END IF;

  RETURN waves_sent;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_dispatch_wave(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_dispatch_offer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_dispatch_offers(uuid) TO authenticated;

-- Auto-dispatch first wave on job insert
CREATE OR REPLACE FUNCTION public.trigger_initial_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'open' THEN
    PERFORM public.create_dispatch_wave(NEW.id, 5);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_initial_dispatch ON public.jobs;
CREATE TRIGGER jobs_initial_dispatch
  AFTER INSERT ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.trigger_initial_dispatch();
