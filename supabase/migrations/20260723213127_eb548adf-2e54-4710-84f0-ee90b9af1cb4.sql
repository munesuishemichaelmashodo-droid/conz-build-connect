
CREATE OR REPLACE FUNCTION public.raise_dispute(_job_id uuid, _against uuid, _category text, _reason text)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _job public.jobs;
  _dispute public.disputes;
  _cat public.dispute_category;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;

  BEGIN
    _cat := _category::public.dispute_category;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid dispute category: %', _category;
  END;

  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'Please describe the issue';
  END IF;

  SELECT * INTO _job FROM public.jobs WHERE id = _job_id;
  IF _job IS NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  IF auth.uid() <> _job.customer_id AND auth.uid() <> COALESCE(_job.driver_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'You are not a participant in this job';
  END IF;

  IF _job.status NOT IN ('accepted','in_progress','completed') THEN
    RAISE EXCEPTION 'Disputes can only be raised for accepted, in-progress, or completed jobs';
  END IF;

  SELECT * INTO _dispute
  FROM public.disputes
  WHERE job_id = _job_id AND raised_by = auth.uid() AND status = 'open'
  LIMIT 1;

  IF _dispute.id IS NOT NULL THEN
    RETURN _dispute;
  END IF;

  INSERT INTO public.disputes (job_id, raised_by, against, category, reason, status, review_due_at)
  VALUES (_job_id, auth.uid(), _against, _cat, _reason, 'open', now() + interval '48 hours')
  RETURNING * INTO _dispute;

  RETURN _dispute;
END;
$$;

GRANT EXECUTE ON FUNCTION public.raise_dispute(uuid, uuid, text, text) TO authenticated;
