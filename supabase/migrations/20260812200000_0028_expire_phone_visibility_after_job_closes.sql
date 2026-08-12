-- Phone number visibility between a customer and driver should only last while
-- their job is actively in progress (accepted or in_progress), not linger
-- indefinitely after the job is completed or cancelled. Bidding-stage visibility
-- ("Customers view bidders on own jobs") is untouched — that's pre-accept and
-- still needed for the customer to evaluate/contact bidders.
DROP POLICY IF EXISTS "Users can view profiles of active job partners" ON public.profiles;

CREATE POLICY "Users can view profiles of active job partners"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM jobs
    WHERE jobs.status IN ('accepted', 'in_progress')
      AND (
        (jobs.customer_id = auth.uid() AND jobs.driver_id = profiles.id)
        OR (jobs.driver_id = auth.uid() AND jobs.customer_id = profiles.id)
      )
  )
);
