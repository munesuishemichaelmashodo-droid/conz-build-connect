CREATE TABLE public.customer_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  punctuality int NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
  communication int NOT NULL CHECK (communication BETWEEN 1 AND 5),
  payment int NOT NULL CHECK (payment BETWEEN 1 AND 5),
  overall int NOT NULL CHECK (overall BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, driver_id)
);

GRANT SELECT, INSERT ON public.customer_ratings TO authenticated;
GRANT ALL ON public.customer_ratings TO service_role;

ALTER TABLE public.customer_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read customer ratings"
  ON public.customer_ratings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Driver can rate the customer of their completed job"
  ON public.customer_ratings FOR INSERT
  TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id
        AND j.driver_id = auth.uid()
        AND j.customer_id = customer_ratings.customer_id
        AND j.status = 'completed'
    )
  );