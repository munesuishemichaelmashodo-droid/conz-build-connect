-- 0035: Two related gaps found by the owner testing the bid-accept flow
-- as a driver:
--
-- 1. tg_notify_bid_status only ever fired a notification for the WINNING
--    bid. accept_bid() correctly marks every other pending bid on the job
--    'rejected' in the database, but the losing driver(s) got zero signal
--    -- no notification, and (see #2) no live UI update either -- so they
--    kept seeing the job as if it were still open/pending on their end.
-- 2. jobs.index.tsx (the driver's browse/open-jobs list) has no realtime
--    subscription at all. Only the single job detail page (jobs.$id.tsx)
--    got realtime in the previous fix (12d7ffe) -- a driver sitting on the
--    LIST screen, whether they won or lost a bid, saw nothing change until
--    they manually left and came back. This explains both "the other
--    driver was still showing on there" and any lingering case of a
--    winning driver not immediately seeing they should move to the
--    pickup-photo step while sitting on the list rather than the job page.

CREATE OR REPLACE FUNCTION public.tg_notify_bid_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _job public.jobs;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.driver_id, 'bid_accepted',
            'Your bid was accepted!',
            'You won the ' || _job.material || ' job for $' || NEW.price::text,
            NEW.job_id);
  ELSIF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    SELECT * INTO _job FROM public.jobs WHERE id = NEW.job_id;
    INSERT INTO public.notifications(user_id, type, title, body, job_id)
    VALUES (NEW.driver_id, 'bid_rejected',
            'Job no longer available',
            'The ' || _job.material || ' job you bid on went to another driver.',
            NEW.job_id);
  END IF;
  RETURN NEW;
END $$;
