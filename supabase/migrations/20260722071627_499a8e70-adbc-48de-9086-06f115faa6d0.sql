
CREATE OR REPLACE FUNCTION public.count_available_verified_drivers(_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _cnt integer;
BEGIN
  SELECT COUNT(*) INTO _cnt
  FROM public.driver_profiles dp
  JOIN public.user_roles ur ON ur.user_id = dp.user_id AND ur.role = 'driver'
  WHERE dp.verification_status = 'verified'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.driver_id = dp.user_id
        AND j.status IN ('accepted','in_progress')
    );
  RETURN COALESCE(_cnt, 0);
END $$;

GRANT EXECUTE ON FUNCTION public.count_available_verified_drivers(uuid) TO authenticated;
