
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Default expiry: 10 seconds after creation for future rows
ALTER TABLE public.jobs
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '10 seconds');

-- Backfill existing open jobs with a fresh 10s window from now (harmless for non-open)
UPDATE public.jobs
  SET expires_at = COALESCE(expires_at, created_at + interval '10 seconds')
  WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_open_expires
  ON public.jobs(expires_at) WHERE status = 'open';

-- Sweep function: cancel any open jobs past their 10s window, notify customer,
-- and expire any lingering pending offers.
CREATE OR REPLACE FUNCTION public.expire_stale_open_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _cnt integer := 0; _row public.jobs;
BEGIN
  FOR _row IN
    SELECT * FROM public.jobs
    WHERE status = 'open'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.jobs SET status = 'cancelled' WHERE id = _row.id;

    UPDATE public.job_dispatch_offers
      SET status = 'expired', responded_at = now()
      WHERE job_id = _row.id AND status = 'pending';

    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (_row.customer_id, 'job_expired',
            'No driver accepted in time',
            'Your ' || _row.material || ' request expired after 10s. Please book again.',
            _row.id);

    _cnt := _cnt + 1;
  END LOOP;
  RETURN _cnt;
END $$;

GRANT EXECUTE ON FUNCTION public.expire_stale_open_jobs() TO authenticated, anon;
